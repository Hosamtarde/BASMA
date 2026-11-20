import { Client } from 'pg';
import type { Pool } from 'pg';
import request from 'supertest';
import { CASE_DUE_SOON_DAYS, duePhase, IN_LAB_STATUSES } from '../../src/modules/notifications/domain/notification-rules';
import { CHEQUE_DUE_SOON_DAYS } from '../../src/modules/payments/domain/payment-rules';
import { startTestApp, TestApp } from '../support/app';
import { loadDataset, TARGET_SIZE } from '../support/large-dataset';
import { tokenWith } from '../support/tokens';

jest.setTimeout(900_000);

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};

interface Feed {
  today: string;
  total: number;
  unread: number;
  groups: { type: string; total: number; items: { key: string; phase: string; date: string; entity: { id: number } }[] }[];
}

/**
 * B5 plan §5.3 at the SPEC scale (20 000 cases / 50 000 payments / 10 000 outgoing). The dataset is
 * harsh for the feed: its cases were received in 2025, so nearly every case still in the lab is
 * overdue. Asserted: the feed equals the pure phase rule over every row, the statement count does
 * not grow with the data, the queries use their indexes. Timings are logged for the report.
 */
describe('notifications feed at the SPEC scale', () => {
  let t: TestApp;
  let pool: Pool;
  const get = (url: string) => request(t.http).get(url).set('Authorization', t.auth);

  /** Counts every statement sent by any pg client (the feed runs inside a transaction on one client). */
  async function countStatements(fn: () => Promise<unknown>): Promise<number> {
    const proto = Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
    const original = proto.query;
    let n = 0;
    proto.query = function (this: unknown, ...a: unknown[]) {
      n += 1;
      return original.apply(this, a);
    };
    try {
      await fn();
    } finally {
      proto.query = original;
    }
    return n;
  }

  beforeAll(async () => {
    t = await startTestApp();
    pool = t.pool;
    await loadDataset(pool, TARGET_SIZE);
    // Some delivered cases with a collect date (none in the generic dataset).
    await pool.query(
      `UPDATE cases SET collect_on = delivered_date + (id % 900)::int
       WHERE status = 'delivered' AND id % 7 = 0`,
    );
    await pool.query('ANALYZE');
  });
  afterAll(async () => {
    await t?.close();
  });

  it('the case and cheque groups equal the pure phase rule applied to every row', async () => {
    const feed = (await get('/api/v1/notifications?limit=50').expect(200)).body as Feed;
    const today = feed.today;
    const cases = await pool.query<{ id: string; expected_date: string; status: string }>(
      `SELECT id::text, expected_date::text, status FROM cases`,
    );
    const expectedCases = cases.rows.filter(
      (c) =>
        (IN_LAB_STATUSES as readonly string[]).includes(c.status) &&
        duePhase(c.expected_date, today, CASE_DUE_SOON_DAYS) !== null,
    ).length;
    expect(feed.groups.find((g) => g.type === 'case_due')?.total).toBe(expectedCases);
    expect(expectedCases).toBeGreaterThan(1000);

    const inCheques = await pool.query<{ due_date: string }>(
      `SELECT ch.due_date::text FROM cheques ch JOIN payments p ON p.id = ch.payment_id
       WHERE ch.status = 'pending' AND p.status = 'active'`,
    );
    expect(feed.groups.find((g) => g.type === 'cheque_in_due')?.total).toBe(
      inCheques.rows.filter((r) => duePhase(r.due_date, today, CHEQUE_DUE_SOON_DAYS) !== null).length,
    );
    const outCheques = await pool.query<{ due_date: string }>(
      `SELECT ch.due_date::text FROM cheques ch JOIN outgoing_payments o ON o.id = ch.outgoing_payment_id
       WHERE ch.status = 'pending' AND o.status = 'active'`,
    );
    expect(feed.groups.find((g) => g.type === 'cheque_out_due')?.total).toBe(
      outCheques.rows.filter((r) => duePhase(r.due_date, today, CHEQUE_DUE_SOON_DAYS) !== null).length,
    );
    for (const g of feed.groups) expect(g.items.length).toBeLessThanOrEqual(50);
  });

  it('costs a fixed number of statements however large the feed is', async () => {
    const big = await countStatements(() => get('/api/v1/notifications/count').expect(200));
    const listed = await countStatements(() => get('/api/v1/notifications?limit=50').expect(200));
    // eslint-disable-next-line no-console
    console.log(`STATEMENTS count=${big} feed=${listed}`);
    expect(big).toBeLessThanOrEqual(16);
    expect(listed).toBeLessThanOrEqual(17);
  });

  it('the feed queries use their indexes', async () => {
    const plan = async (q: string) =>
      JSON.stringify((await pool.query<{ 'QUERY PLAN': unknown }>(`EXPLAIN (FORMAT JSON) ${q}`)).rows[0]?.['QUERY PLAN']);
    // A lab with a normal backlog: only recent cases are near their date.
    expect(
      await plan(
        `SELECT id FROM cases WHERE status IN ('waiting','design','in_progress','ready','returned') AND expected_date <= date '2025-01-05'`,
      ),
    ).toMatch(/cases_status_expected_ix/);
    expect(
      await plan(`SELECT id FROM cheques WHERE status = 'pending' AND due_date <= date '2025-01-05'`),
    ).toMatch(/cheques_status_due_ix/);
    expect(
      await plan(`SELECT id FROM cases WHERE collect_on IS NOT NULL AND collect_on <= date '2025-01-05' AND status = 'delivered'`),
    ).toMatch(/cases_collect_on_ix/);
  });

  it('records timings (logged for the report; guard only against gross regressions)', async () => {
    async function time(label: string, runs: number, fn: () => Promise<unknown>): Promise<number> {
      const ms: number[] = [];
      for (let i = 0; i < runs; i++) {
        const s = process.hrtime.bigint();
        await fn();
        ms.push(Number(process.hrtime.bigint() - s) / 1e6);
      }
      // eslint-disable-next-line no-console
      console.log(`TIMING ${label}: p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${pct(ms, 95).toFixed(1)} ms (${runs} runs)`);
      return pct(ms, 95);
    }
    const guard = 3000;
    for (const perms of [['cases.read'], ['cheques.read'], ['cheques.read', 'expenses.read'], ['cases.read', 'ledger.read']]) {
      const auth = await tokenWith(t, ['notifications.read', ...perms]);
      await time(`count only ${perms.join('+')}`, 10, () => request(t.http).get('/api/v1/notifications/count').set('Authorization', auth).expect(200));
    }
    expect(await time('GET /notifications/count (harsh dataset)', 20, () => get('/api/v1/notifications/count').expect(200))).toBeLessThan(guard);
    expect(await time('GET /notifications?limit=20 (harsh dataset)', 20, () => get('/api/v1/notifications').expect(200))).toBeLessThan(guard);

    // A normal backlog: move every in-lab case but 60 into the future, as in a lab that keeps up.
    await pool.query(
      `UPDATE cases SET expected_date = current_date + 30 WHERE status IN ('waiting','design','in_progress','ready','returned') AND id % 300 <> 0`,
    );
    await pool.query('ANALYZE cases');
    expect(await time('GET /notifications/count (normal backlog)', 20, () => get('/api/v1/notifications/count').expect(200))).toBeLessThan(guard);
    expect(await time('GET /notifications?limit=20 (normal backlog)', 20, () => get('/api/v1/notifications').expect(200))).toBeLessThan(guard);
  });
});
