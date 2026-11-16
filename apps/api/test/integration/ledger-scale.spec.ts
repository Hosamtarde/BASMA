import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import request from 'supertest';
import { LedgerRepository } from '../../src/modules/payments/infrastructure/ledger.repository';
import {
  allocate,
  breakdown as buildBreakdown,
  doctorBalance,
} from '../../src/modules/payments/domain/payment-rules';
import { PG_POOL } from '../../src/shared/db/database';
import * as schema from '../../src/shared/db/schema';
import { startTestApp, TestApp } from '../support/app';
import { loadDataset, TARGET_SIZE } from '../support/large-dataset';

jest.setTimeout(900_000);

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};

/**
 * B4 §4.1 and §1.4 at the SPEC scale (20 000 cases / 50 000 payments / 500 doctors): the list figures
 * cost a fixed number of statements, equal `allocate` run on one doctor alone, and tie out.
 * Assertions are structural (statement counts, equality, EXPLAIN); timings are logged, with a
 * generous guard only against gross regressions, so a slow CI machine cannot make this flaky.
 */
describe('ledger at the SPEC scale (20 000 cases / 50 000 payments)', () => {
  let t: TestApp;
  let doctorIds: number[];
  let pool: Pool;
  const repo = new LedgerRepository();
  const get = (url: string) => request(t.http).get(url).set('Authorization', t.auth);

  /** Counts every statement the API sends through its pool while `fn` runs. */
  async function countStatements(fn: () => Promise<unknown>): Promise<number> {
    const p = t.app.get<Pool>(PG_POOL);
    const original = p.query.bind(p) as (...a: unknown[]) => unknown;
    let n = 0;
    (p as unknown as { query: unknown }).query = (...a: unknown[]) => {
      n += 1;
      return original(...a);
    };
    try {
      await fn();
    } finally {
      (p as unknown as { query: unknown }).query = original;
    }
    return n;
  }

  beforeAll(async () => {
    t = await startTestApp();
    pool = t.pool;
    const t0 = Date.now();
    doctorIds = await loadDataset(pool, TARGET_SIZE);
    // eslint-disable-next-line no-console
    console.log(`dataset loaded in ${Date.now() - t0} ms`);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('GET /cases costs the same number of statements for page sizes 5, 25 and 100', async () => {
    const counts: number[] = [];
    for (const size of [5, 25, 100]) {
      counts.push(await countStatements(async () => void (await get(`/api/v1/cases?pageSize=${size}`).expect(200))));
    }
    // eslint-disable-next-line no-console
    console.log(`statements for GET /cases at page sizes 5/25/100: ${counts.join(' / ')}`);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThanOrEqual(12);
  });

  it('GET /doctors costs the same number of statements for page sizes 5 and 100', async () => {
    const a = await countStatements(async () => void (await get('/api/v1/doctors?pageSize=5').expect(200)));
    const b = await countStatements(async () => void (await get('/api/v1/doctors?pageSize=100').expect(200)));
    expect(a).toBe(b);
  });

  it('every paid / remaining of a 100-row page equals allocate() run on that doctor alone', async () => {
    const db = drizzle(pool, { schema });
    const page = (await get('/api/v1/cases?pageSize=100&page=3').expect(200)).body.items as {
      id: number;
      doctor: { id: number };
      status: string;
      total: number;
      paid: number;
      remaining: number;
    }[];
    expect(page).toHaveLength(100);
    const doctors = [...new Set(page.map((r) => r.doctor.id))];
    for (const id of doctors) {
      const input = await repo.doctorInput(db, id);
      const alloc = allocate(input!.opening, input!.cases, input!.counted);
      for (const row of page.filter((r) => r.doctor.id === id)) {
        const expected = row.status === 'cancelled' ? { paid: 0, remaining: 0 } : alloc.cases.get(row.id);
        expect({ id: row.id, paid: row.paid, remaining: row.remaining }).toEqual({
          id: row.id,
          paid: expected!.paid,
          remaining: expected!.remaining,
        });
      }
    }
  });

  it('SQL balances equal doctorBalance for ALL 500 doctors (every cheque state, bound, void, cancelled)', async () => {
    const db = drizzle(pool, { schema });
    const inputs = await repo.doctorInputs(db, doctorIds);
    const sql = await repo.balancesOf(db, doctorIds);
    expect(inputs.size).toBe(500);
    for (const id of doctorIds) {
      const i = inputs.get(id)!;
      const ts = doctorBalance(
        i.opening,
        i.cases,
        i.counted.reduce((s, p) => s + p.amount, 0),
      );
      expect({ id, sql: sql.get(id)?.balance }).toEqual({ id, sql: ts });
    }
  });

  it('tie-out: balance = breakdown equation = statement closing, for the heavy doctor and 40 others', async () => {
    const sample = [doctorIds[0]!, ...doctorIds.filter((_, i) => i % 12 === 5).slice(0, 40)];
    for (const id of sample) {
      const bal = (await get(`/api/v1/doctors/${id}/balance`).expect(200)).body.balance as number;
      const bd = (await get(`/api/v1/doctors/${id}/debt-breakdown?pageSize=1`).expect(200)).body as {
        tieOut: { openingRemaining: number; casesRemaining: number; credit: number; balance: number };
      };
      const st = (await get(`/api/v1/doctors/${id}/statement?pageSize=1`).expect(200)).body as { closing: number };
      const eq = bd.tieOut.openingRemaining + bd.tieOut.casesRemaining - bd.tieOut.credit;
      expect({ id, bal, eq, tie: bd.tieOut.balance, closing: st.closing }).toEqual({
        id,
        bal,
        eq: bal,
        tie: bal,
        closing: bal,
      });
    }
  });

  it('pure breakdown() ties out for every one of the 500 doctors', async () => {
    const db = drizzle(pool, { schema });
    const inputs = await repo.doctorInputs(db, doctorIds);
    for (const i of inputs.values()) {
      expect({ id: i.doctorId, ok: buildBreakdown(i.opening, i.cases, i.counted).tiesOut }).toEqual({
        id: i.doctorId,
        ok: true,
      });
    }
  });

  it('the batched statements use the indexes (no sequential scan of payments for a page of doctors)', async () => {
    const ids = doctorIds.slice(100, 125);
    const list = ids.join(',');
    const plan = async (q: string): Promise<string> => {
      const r = await pool.query<{ 'QUERY PLAN': unknown }>(`EXPLAIN (FORMAT JSON) ${q}`);
      return JSON.stringify(r.rows[0]?.['QUERY PLAN']);
    };
    const payPlan = await plan(
      `SELECT p.doctor_id, p.case_id, sum(p.amount) FROM payments p LEFT JOIN cheques ch ON ch.payment_id = p.id
       WHERE p.doctor_id IN (${list}) AND p.status = 'active' AND (p.method <> 'cheque' OR ch.status = 'cleared')
       GROUP BY p.doctor_id, p.case_id`,
    );
    const casePlan = await plan(
      `SELECT id, case_no, received_date, total, status FROM cases WHERE doctor_id IN (${list}) ORDER BY received_date, case_no`,
    );
    expect(payPlan).not.toMatch(/"Node Type":"Seq Scan","Parallel Aware":(true|false),"Async Capable":(true|false),"Relation Name":"payments"/);
    expect(payPlan).toMatch(/payments_doctor_paid_ix/);
    expect(casePlan).toMatch(/cases_doctor_received_ix/);
    expect(casePlan).not.toMatch(/"Relation Name":"cases"[^}]*"Node Type":"Seq Scan"|"Node Type":"Seq Scan"[^}]*"Relation Name":"cases"/);
  });

  it('records timings (logged for the stage report; guard only against gross regressions)', async () => {
    async function time(label: string, runs: number, fn: (i: number) => Promise<unknown>): Promise<number> {
      const ms: number[] = [];
      for (let i = 0; i < runs; i++) {
        const s = process.hrtime.bigint();
        await fn(i);
        ms.push(Number(process.hrtime.bigint() - s) / 1e6);
      }
      // eslint-disable-next-line no-console
      console.log(`TIMING ${label}: p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${pct(ms, 95).toFixed(1)} ms (${runs} runs)`);
      return pct(ms, 95);
    }
    const guard = 1000;
    expect(await time('GET /cases?pageSize=25 (with paid/remaining)', 20, (i) => get(`/api/v1/cases?pageSize=25&page=${1 + (i % 50)}`).expect(200))).toBeLessThan(guard);
    expect(await time('GET /cases?pageSize=100', 10, (i) => get(`/api/v1/cases?pageSize=100&page=${1 + (i % 50)}`).expect(200))).toBeLessThan(guard);
    expect(await time('GET /cases?doctorId=<heavy>&pageSize=25', 10, () => get(`/api/v1/cases?doctorId=${doctorIds[0]}&pageSize=25`).expect(200))).toBeLessThan(guard);
    expect(await time('GET /doctors?pageSize=25 (with balance)', 20, () => get('/api/v1/doctors?pageSize=25').expect(200))).toBeLessThan(guard);
    expect(await time('GET /doctors/{heavy}/debt-breakdown', 10, () => get(`/api/v1/doctors/${doctorIds[0]}/debt-breakdown`).expect(200))).toBeLessThan(guard);
    expect(await time('GET /doctors/{normal}/debt-breakdown', 20, (i) => get(`/api/v1/doctors/${doctorIds[20 + i]}/debt-breakdown`).expect(200))).toBeLessThan(guard);
    expect(await time('GET /payments/summary', 10, () => get('/api/v1/payments/summary?from=2025-01-01&to=2026-12-31').expect(200))).toBeLessThan(guard);
    expect(await time('GET /debts', 10, () => get('/api/v1/debts?pageSize=25').expect(200))).toBeLessThan(guard);
  });
});
