import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

/** 2026-11-10 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-10T10:00:00Z';
const TODAY = '2026-11-10';
const ALL = ['notifications.read', 'cases.read', 'cheques.read', 'expenses.read', 'ledger.read'];

interface Item {
  key: string;
  type: string;
  phase: string;
  date: string;
  entity: { kind: string; id: number; direction?: string; chequeNo?: string };
  params: Record<string, string | number>;
  text: string;
  seen: boolean;
}
interface Feed {
  today: string;
  unread: number;
  total: number;
  groups: { type: string; total: number; unread: number; items: Item[] }[];
}

/**
 * B5 notifications feed (SPEC §5.16; docs/plans/b5-delivery-notifications-backlog.md §5). The feed is
 * global to the installation, so each test looks for the keys of the records it made, never at totals
 * of other tests' data (except where the whole feed is compared with its own count).
 */
describe('Notifications feed (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object, key?: string) => {
    const r = request(t.http).post(api(path)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const patch = (path: string, body: object, auth = t.auth) =>
    request(t.http).patch(api(path)).set('Authorization', auth).send(body);
  const get = (path: string, auth = t.auth, lang = 'ar') =>
    request(t.http).get(api(path)).set('Authorization', auth).set('Accept-Language', lang);
  const feed = async (auth = t.auth, lang = 'ar') => (await get('/notifications?limit=50', auth, lang).expect(200)).body as Feed;
  const items = (f: Feed) => f.groups.flatMap((g) => g.items);
  const find = (f: Feed, type: string, id: number) => items(f).find((i) => i.type === type && i.entity.id === id);

  let workType: number;
  let rent: number;
  let seq = 0;
  const doctor = async (name = `Dr Bell ${++seq}-${randomUUID().slice(0, 6)}`) =>
    (await post('/doctors', { name }).expect(201)).body.id as number;
  const newCase = async (doctorId: number, expectedDate: string, status = 'design', price = 10_000) =>
    (
      await post('/cases', {
        doctorId,
        patientName: 'Patient Bell',
        receivedDate: '2026-11-01',
        expectedDate,
        status,
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      }).expect(201)
    ).body as { id: number; caseNo: number; rowVersion: number };
  const chequeIn = async (doctorId: number, dueDate: string) =>
    (
      await post(
        '/payments',
        { doctorId, method: 'cheque', amount: 2_500, cheque: { chequeNo: `N-${++seq}`, bank: 'Bell Bank', dueDate } },
        randomUUID(),
      ).expect(201)
    ).body.payment as { id: number; rowVersion: number; cheque: { id: number; rowVersion: number; chequeNo: string } };
  const chequeOut = async (dueDate: string) =>
    (
      await post(
        '/outgoing-payments',
        {
          categoryId: rent,
          payee: 'Landlord Bell',
          method: 'cheque',
          amount: 3_000,
          cheque: { chequeNo: `O-${++seq}`, bank: 'Lab Bank', dueDate },
        },
        randomUUID(),
      ).expect(201)
    ).body.payment as { id: number; cheque: { id: number } };

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', { rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' }).expect(200);
    workType = (await post('/work-types', { name: 'Bell crown', unitPrice: 10_000 }).expect(201)).body.id as number;
    rent = (await post('/expense-categories', { name: 'Bell rent' }).expect(201)).body.id as number;
  });
  afterAll(async () => {
    await t?.close();
  });
  afterEach(() => clock.set(NOON));

  describe('authorization', () => {
    it('401 without a token; 403 without notifications.read', async () => {
      await request(t.http).get(api('/notifications')).expect(401);
      await request(t.http).get(api('/notifications/count')).expect(401);
      await get('/notifications', await tokenWith(t, ['cases.read'])).expect(403);
      await get('/notifications/count', await tokenWith(t, ['cases.read'])).expect(403);
      await patch('/notifications/state', { keys: ['x'], seen: true }, await tokenWith(t, ['cases.read'])).expect(403);
    });

    it('each type needs the read permission of what it is about', async () => {
      const d = await doctor();
      await newCase(d, TODAY);
      await chequeIn(d, TODAY);
      await chequeOut(TODAY);
      const c = await newCase(d, '2026-11-05', 'ready');
      await post(`/cases/${c.id}/delivery`, { rowVersion: c.rowVersion, received: 'none', collectOn: TODAY }).expect(200);
      const typesFor = async (perms: string[]) =>
        (await feed(await tokenWith(t, perms))).groups.map((g) => g.type);
      expect(await typesFor(ALL)).toEqual(['case_due', 'cheque_in_due', 'cheque_out_due', 'collect_due']);
      expect(await typesFor(['notifications.read'])).toEqual([]);
      expect(await typesFor(['notifications.read', 'cases.read'])).toEqual(['case_due']);
      expect(await typesFor(['notifications.read', 'cheques.read'])).toEqual(['cheque_in_due']);
      // Outgoing cheques need expenses.read too; the collect reminder needs the ledger (S21, B4b X10).
      expect(await typesFor(['notifications.read', 'cheques.read', 'expenses.read'])).toEqual(['cheque_in_due', 'cheque_out_due']);
      expect(await typesFor(['notifications.read', 'cases.read', 'ledger.read'])).toEqual(['case_due', 'collect_due']);
    });
  });

  describe('what appears', () => {
    it('cases still in the lab, due within 2 days or overdue (N5); never delivered or cancelled', async () => {
      const d = await doctor();
      const soon = await newCase(d, '2026-11-12');
      const today = await newCase(d, TODAY, 'ready');
      const later = await newCase(d, '2026-11-13');
      const late = await newCase(d, '2026-11-09', 'waiting');
      const cancelled = await newCase(d, '2026-11-09');
      await post(`/cases/${cancelled.id}/cancel`, { rowVersion: cancelled.rowVersion }).expect(200);
      const returned = await newCase(d, '2026-11-08', 'ready');
      const del = (
        await post(`/cases/${returned.id}/delivery`, { rowVersion: returned.rowVersion, received: 'none', collectOn: '2026-11-30' }).expect(
          200,
        )
      ).body.case as { rowVersion: number };
      const f1 = await feed();
      expect(find(f1, 'case_due', returned.id)).toBeUndefined(); // delivered
      await post(`/cases/${returned.id}/status`, { rowVersion: del.rowVersion, to: 'returned' }).expect(200);

      const f = await feed();
      expect(find(f, 'case_due', soon.id)).toMatchObject({ phase: 'soon', date: '2026-11-12', key: `case_due:${soon.id}:soon:2026-11-12` });
      expect(find(f, 'case_due', today.id)).toMatchObject({ phase: 'soon' });
      expect(find(f, 'case_due', late.id)).toMatchObject({ phase: 'overdue', date: '2026-11-09' });
      expect(find(f, 'case_due', returned.id)).toMatchObject({ phase: 'overdue' });
      expect(find(f, 'case_due', later.id)).toBeUndefined();
      expect(find(f, 'case_due', cancelled.id)).toBeUndefined();
      expect(find(f, 'case_due', soon.id)?.text).toBe(`الحالة رقم ${soon.caseNo} للطبيب «${(await get(`/doctors/${d}`).expect(200)).body.name}» موعد تسليمها 2026-11-12.`);
      // Overdue items come first.
      const caseItems = f.groups.find((g) => g.type === 'case_due')!.items;
      const firstSoon = caseItems.findIndex((i) => i.phase === 'soon');
      expect(caseItems.slice(firstSoon).every((i) => i.phase === 'soon')).toBe(true);
    });

    it('pending cheques of active payments due within 7 days, both directions; cleared, returned or void ones never', async () => {
      const d = await doctor();
      const soon = await chequeIn(d, '2026-11-17');
      const later = await chequeIn(d, '2026-11-18');
      const late = await chequeIn(d, '2026-11-01');
      const cleared = await chequeIn(d, '2026-11-11');
      await patch(`/cheques/${cleared.cheque.id}/status`, { rowVersion: cleared.cheque.rowVersion, status: 'cleared' }).expect(200);
      const voided = await chequeIn(d, '2026-11-11');
      await post(`/payments/${voided.id}/void`, { rowVersion: voided.rowVersion, reason: 'wrong doctor' }).expect(200);
      const out = await chequeOut('2026-11-15');

      const f = await feed();
      expect(find(f, 'cheque_in_due', soon.cheque.id)).toMatchObject({
        phase: 'soon',
        entity: { kind: 'cheque', direction: 'in', chequeNo: soon.cheque.chequeNo },
        params: { amount: 2_500 },
      });
      expect(find(f, 'cheque_in_due', late.cheque.id)).toMatchObject({ phase: 'overdue' });
      expect(find(f, 'cheque_in_due', later.cheque.id)).toBeUndefined();
      expect(find(f, 'cheque_in_due', cleared.cheque.id)).toBeUndefined();
      expect(find(f, 'cheque_in_due', voided.cheque.id)).toBeUndefined();
      const o = find(f, 'cheque_out_due', out.cheque.id);
      expect(o).toMatchObject({ phase: 'soon', entity: { direction: 'out' } });
      expect(o?.text).toContain('30.00 ₪');
      expect(o?.text).toContain('«Landlord Bell»');
      // Each direction only in its own group.
      expect(find(f, 'cheque_in_due', out.cheque.id)).toBeUndefined();
    });

    it('collect due: a delivered case whose collect date has come and something is still owed', async () => {
      const d = await doctor();
      const c = await newCase(d, '2026-11-05', 'ready', 7_000);
      const r = (
        await post(`/cases/${c.id}/delivery`, { rowVersion: c.rowVersion, received: 'none', collectOn: '2026-11-11' }).expect(200)
      ).body.case as { rowVersion: number };
      expect(find(await feed(), 'collect_due', c.id)).toBeUndefined(); // tomorrow
      const moved = await patch(`/cases/${c.id}/collect-on`, { rowVersion: r.rowVersion, collectOn: TODAY }).expect(200);
      const due = find(await feed(), 'collect_due', c.id);
      expect(due).toMatchObject({ phase: 'due', date: TODAY, key: `collect_due:${c.id}:due:${TODAY}`, params: { amount: 7_000 } });
      expect(find(await feed(undefined, 'en'), 'collect_due', c.id)?.text).toBe(
        `Collection due: case ${c.caseNo} for «${(await get(`/doctors/${d}`).expect(200)).body.name}», 70.00 ₪ left (date ${TODAY}).`,
      );
      // Paid in full: the reminder stops, the date stays.
      await post('/payments', { doctorId: d, caseId: c.id, method: 'cash', amount: 7_000 }, randomUUID()).expect(201);
      expect(find(await feed(), 'collect_due', c.id)).toBeUndefined();
      expect((await get(`/cases/${c.id}`).expect(200)).body.collectOn).toBe(TODAY);
      expect(moved.body.collectOn).toBe(TODAY);
    });

    it('phases follow the lab’s midnight, not the server clock (TZ=UTC runs)', async () => {
      const d = await doctor();
      const c = await newCase(d, TODAY);
      clock.set('2026-11-10T21:59:59Z'); // 23:59:59 in Hebron
      expect(find(await feed(), 'case_due', c.id)?.phase).toBe('soon');
      clock.set('2026-11-10T22:00:00Z'); // 00:00 on the 11th in Hebron, still the 10th in UTC
      expect(find(await feed(), 'case_due', c.id)).toMatchObject({ phase: 'overdue', key: `case_due:${c.id}:overdue:${TODAY}` });
      expect((await feed()).today).toBe('2026-11-11');
    });
  });

  describe('read, hidden, per user', () => {
    it('seen lowers the unread count; hidden leaves the list until the item changes phase (N6)', async () => {
      const d = await doctor();
      const c = await newCase(d, '2026-11-11');
      const before = await feed();
      const item = find(before, 'case_due', c.id)!;
      expect(item.seen).toBe(false);

      await patch('/notifications/state', { keys: [item.key], seen: true }).expect(204);
      const afterSeen = await feed();
      expect(find(afterSeen, 'case_due', c.id)?.seen).toBe(true);
      expect(afterSeen.unread).toBe(before.unread - 1);
      expect(afterSeen.total).toBe(before.total);

      await patch('/notifications/state', { keys: [item.key], dismissed: true }).expect(204);
      const hidden = await feed();
      expect(find(hidden, 'case_due', c.id)).toBeUndefined();
      expect(hidden.total).toBe(before.total - 1);
      expect(await (await get('/notifications/count')).body).toEqual({ unread: hidden.unread, total: hidden.total });

      // Two days later it is overdue: a new key, unread again.
      clock.set('2026-11-12T10:00:00Z');
      expect(find(await feed(), 'case_due', c.id)).toMatchObject({ phase: 'overdue', seen: false });
      clock.set(NOON);

      // Shown again on request.
      await patch('/notifications/state', { keys: [item.key], dismissed: false }).expect(204);
      expect(find(await feed(), 'case_due', c.id)).toMatchObject({ key: item.key, seen: true });
    });

    it('a changed date gives a new key: the item comes back', async () => {
      const d = await doctor();
      const c = await newCase(d, '2026-11-11');
      const item = find(await feed(), 'case_due', c.id)!;
      await patch('/notifications/state', { keys: [item.key], dismissed: true }).expect(204);
      await patch(`/cases/${c.id}`, { rowVersion: c.rowVersion, expectedDate: '2026-11-12' }).expect(200);
      expect(find(await feed(), 'case_due', c.id)).toMatchObject({ key: `case_due:${c.id}:soon:2026-11-12`, seen: false });
    });

    it('marks are per user; keys not in the caller’s feed are ignored', async () => {
      const d = await doctor();
      const c = await newCase(d, '2026-11-11');
      const other = await t.pool.query<{ id: string }>(
        `INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`,
        [`bell-${randomUUID().slice(0, 8)}`],
      );
      const otherAuth = `Bearer ${await new JwtService({ secret: t.config.jwt.accessSecret }).signAsync(
        { sub: other.rows[0]!.id, perms: ALL },
        { algorithm: 'HS256', expiresIn: 600 },
      )}`;
      const key = find(await feed(), 'case_due', c.id)!.key;
      await patch('/notifications/state', { keys: [key], dismissed: true }).expect(204);
      expect(find(await feed(), 'case_due', c.id)).toBeUndefined();
      expect(find(await feed(otherAuth), 'case_due', c.id)).toMatchObject({ key, seen: false });

      await patch('/notifications/state', { keys: ['case_due:999999:soon:2026-11-11', 'made-up'], seen: true }).expect(204);
      const stored = await t.pool.query(`SELECT key FROM notification_states WHERE key IN ('case_due:999999:soon:2026-11-11', 'made-up')`);
      expect(stored.rows).toHaveLength(0);
      // A user's marks are deleted with the user.
      await t.pool.query(`DELETE FROM users WHERE id = $1`, [other.rows[0]!.id]);
    });

    it('purges marks of items gone for more than 180 days (N8)', async () => {
      const me = (await get('/auth/me').expect(200)).body.id as number;
      await t.pool.query(
        `INSERT INTO notification_states (user_id, key, seen_at, created_at) VALUES ($1, 'case_due:1:soon:2026-01-01', now(), now() - interval '181 days'),
                ($1, 'case_due:2:soon:2026-10-01', now(), now() - interval '10 days')`,
        [me],
      );
      const d = await doctor();
      const c = await newCase(d, '2026-11-11');
      await patch('/notifications/state', { keys: [find(await feed(), 'case_due', c.id)!.key], seen: true }).expect(204);
      const left = await t.pool.query<{ key: string }>(
        `SELECT key FROM notification_states WHERE key IN ('case_due:1:soon:2026-01-01', 'case_due:2:soon:2026-10-01')`,
      );
      expect(left.rows.map((r) => r.key)).toEqual(['case_due:2:soon:2026-10-01']);
    });

    it.each([
      ['no keys', { keys: [], seen: true }],
      ['seen false', { keys: ['a'], seen: false }],
      ['a key too long', { keys: ['k'.repeat(101)], seen: true }],
      ['too many keys', { keys: Array.from({ length: 201 }, (_, i) => `k${i}`), seen: true }],
      ['an unknown field', { keys: ['a'], seen: true, everything: true }],
      ['neither keys nor all', { seen: true }],
      ['all with keys', { all: true, seen: true, keys: ['a'] }],
      ['all with dismissed', { all: true, dismissed: true }],
      ['all without seen', { all: true }],
    ])('400 for %s', async (_l, body) => {
      const res = await patch('/notifications/state', body).expect(400);
      expect(res.body.error.code).toBe('error.validation.failed');
    });
  });

  describe('opening the bell (all: true)', () => {
    it('marks every item of the feed read, also beyond the listed ones; new items are unread again', async () => {
      const d = await doctor();
      for (let i = 0; i < 3; i++) await newCase(d, TODAY);
      await chequeIn(d, TODAY);
      expect((await get('/notifications/count').expect(200)).body.unread).toBeGreaterThan(0);
      await patch('/notifications/state', { all: true, seen: true }).expect(204);
      const after = (await get('/notifications/count').expect(200)).body as { unread: number; total: number };
      expect(after.unread).toBe(0);
      expect(after.total).toBeGreaterThan(0);
      const fresh = await newCase(d, TODAY);
      expect((await get('/notifications/count').expect(200)).body.unread).toBe(1);
      expect(find(await feed(), 'case_due', fresh.id)?.seen).toBe(false);
    });
  });

  describe('limits and counts', () => {
    it('lists at most `limit` items per type, with exact totals; count equals the feed', async () => {
      const d = await doctor();
      for (let i = 0; i < 4; i++) await newCase(d, TODAY);
      const small = (await get('/notifications?limit=2').expect(200)).body as Feed;
      const cases = small.groups.find((g) => g.type === 'case_due')!;
      expect(cases.items).toHaveLength(2);
      expect(cases.total).toBeGreaterThanOrEqual(4);
      const full = await feed();
      expect(full.total).toBe(full.groups.reduce((s, g) => s + g.total, 0));
      expect(full.unread).toBe(full.groups.reduce((s, g) => s + g.unread, 0));
      expect((await get('/notifications/count').expect(200)).body).toEqual({ unread: full.unread, total: full.total });
      await get('/notifications?limit=0').expect(400);
      await get('/notifications?limit=51').expect(400);
    });
  });
});
