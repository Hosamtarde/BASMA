import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, statusesOf, TestApp } from '../support/app';

jest.setTimeout(300_000);

/** 2026-11-10 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-10T10:00:00Z';
const TODAY = '2026-11-10';

interface PaymentBody {
  id: number;
  voucherNo: string;
  amount: number;
  status: string;
  counted: boolean;
  rowVersion: number;
  voidReason: string | null;
  doctor: { id: number; name: string };
  case: { id: number; caseNo: number } | null;
  cheque: {
    id: number;
    status: string;
    rowVersion: number;
    allowedStatuses: string[];
    dueState: string;
  } | null;
}
interface Result {
  payment: PaymentBody;
  doctorBalance: number;
}
interface CaseBody {
  id: number;
  caseNo: number;
  rowVersion: number;
  total: number;
  paid: number;
  remaining: number;
  status: string;
  canCancel: boolean;
  advancePayment?: PaymentBody | null;
}

describe('Payments, cheques and balances (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object, key?: string) => {
    const r = request(t.http).post(api(path)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const patch = (path: string, body: object) =>
    request(t.http).patch(api(path)).set('Authorization', t.auth).send(body);
  const get = (path: string) => request(t.http).get(api(path)).set('Authorization', t.auth);

  let workType: number;
  let seq = 0;

  const doctor = async (opening = 0) =>
    (
      await post('/doctors', {
        name: `Dr ${++seq}-${randomUUID().slice(0, 6)}`,
        openingBalance: opening,
      }).expect(201)
    ).body.id as number;
  const newCase = async (doctorId: number, price: number, receivedDate = TODAY, extra: object = {}) => {
    const res = await post('/cases', {
      doctorId,
      patientName: 'P',
      receivedDate,
      expectedDate: '2026-12-31',
      lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      ...extra,
    }).expect(201);
    return res.body as CaseBody;
  };
  const caseOf = async (id: number) => (await get(`/cases/${id}`).expect(200)).body as CaseBody;
  const pay = (body: object, key: string = randomUUID()) => post('/payments', body, key);
  const paid = async (body: object) => (await pay(body).expect(201)).body as Result;
  const balance = async (doctorId: number) =>
    (await get(`/doctors/${doctorId}/balance`).expect(200)).body as {
      balance: number;
      received: number;
      charges: number;
      pendingCheques: number;
      direction: string;
    };
  const cheque = (extra: object = {}) => ({
    chequeNo: `C-${++seq}`,
    bank: 'Bank of Palestine',
    dueDate: '2026-11-15',
    ...extra,
  });
  const setCheque = (chequeId: number, rowVersion: number, status: string, extra: object = {}) =>
    patch(`/cheques/${chequeId}/status`, { rowVersion, status, ...extra });

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', {
      rowVersion: s.body.labProfile.rowVersion,
      timeZone: 'Asia/Hebron',
    }).expect(200);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('currency lock (runs first, while no amount exists)', () => {
    it('a payment alone locks the currency code and decimals; the symbol stays editable', async () => {
      const d = await doctor();
      const before = await get('/settings').expect(200);
      expect(before.body.currency.locked).toEqual({ code: false, decimals: false });
      const first = await paid({ doctorId: d, method: 'cash', amount: 500 });
      expect(first.payment.voucherNo).toBe('IN-000001');
      const after = await get('/settings').expect(200);
      expect(after.body.currency.locked).toEqual({ code: true, decimals: true });
      const res = await patch('/settings/currency', {
        rowVersion: after.body.currency.rowVersion,
        decimals: 3,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.settings.currency_locked');
      await patch('/settings/currency', { rowVersion: after.body.currency.rowVersion, symbol: 'NIS' }).expect(
        200,
      );
    });

    it('a payment racing a currency change never stores an amount under changed decimals', async () => {
      const fresh = await startTestApp({}, { clock });
      try {
        const reqs = (path: string) => ({
          post: (b: object, key?: string) => {
            const r = request(fresh.http).post(`/api/v1${path}`).set('Authorization', fresh.auth);
            return (key ? r.set('Idempotency-Key', key) : r).send(b);
          },
        });
        const d = (await reqs('/doctors').post({ name: 'Dr Race' }).expect(201)).body.id as number;
        const s = await request(fresh.http)
          .get('/api/v1/settings')
          .set('Authorization', fresh.auth)
          .expect(200);
        const [cur, created] = await Promise.all([
          request(fresh.http)
            .patch('/api/v1/settings/currency')
            .set('Authorization', fresh.auth)
            .send({ rowVersion: s.body.currency.rowVersion, decimals: 3 }),
          reqs('/payments').post({ doctorId: d, method: 'cash', amount: 100 }, randomUUID()),
        ]);
        expect(created.status).toBe(201);
        const { rows } = await fresh.pool.query<{ decimals: number }>(
          `SELECT (value->>'decimals')::int AS decimals FROM settings WHERE key = 'currency'`,
        );
        // Either the change won before the payment (then the payment saw it), or it was refused.
        expect(cur.status === 200 ? rows[0]?.decimals === 3 : rows[0]?.decimals === 2).toBe(true);
        if (cur.status !== 200) expect(cur.body.error.code).toBe('error.settings.currency_locked');
        const cur2 = await fresh.pool.query<{ code: string }>('SELECT currency_code AS code FROM payments');
        expect(cur2.rows.every((r) => r.code === 'ILS')).toBe(true);
      } finally {
        await fresh.close();
      }
    });
  });

  describe('setup', () => {
    it('creates the work type used by the cases below', async () => {
      workType = (await post('/work-types', { name: 'Crown', unitPrice: 10000 }).expect(201)).body
        .id as number;
    });
  });

  describe('authorization', () => {
    // Every row has three cells: jest passes `done` as the 3rd argument when a row is shorter.
    const calls: [string, string, object | null][] = [
      ['post', '/payments', { doctorId: 1, method: 'cash', amount: 1 }],
      ['get', '/payments', null],
      ['get', '/payments/1', null],
      ['post', '/payments/1/void', { rowVersion: 1, reason: 'x' }],
      ['get', '/cheques', null],
      ['get', '/cheques/summary', null],
      ['patch', '/cheques/1/status', { rowVersion: 1, status: 'cleared' }],
      ['get', '/doctors/1/balance', null],
      ['get', '/doctors/1/statement', null],
      ['get', '/cases/1/payments', null],
      ['get', '/debts', null],
      ['get', '/ledger/summary', null],
    ];
    it.each(calls)('%s %s needs a token and a permission', async (method, path, body) => {
      const call = (auth?: string) => {
        const r = (request(t.http) as unknown as Record<string, (p: string) => request.Test>)[method]!(
          api(path),
        );
        const withAuth = auth ? r.set('Authorization', auth) : r;
        const keyed = withAuth.set('Idempotency-Key', randomUUID());
        return body ? keyed.send(body) : keyed;
      };
      expect((await call()).status).toBe(401);
      const forbidden = await call(t.limitedAuth);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('error.auth.forbidden');
    });
  });

  describe('creating a payment', () => {
    let d: number;
    beforeAll(async () => {
      d = await doctor();
    });

    it('needs a valid Idempotency-Key', async () => {
      const body = { doctorId: d, method: 'cash', amount: 100 };
      const missing = await post('/payments', body).expect(400);
      expect(missing.body.error.code).toBe('error.idempotency.required');
      await post('/payments', body, 'not-a-uuid').expect(400);
    });

    it.each([
      ['zero amount', { amount: 0 }],
      ['negative amount', { amount: -5 }],
      ['fractional amount', { amount: 10.5 }],
      ['string amount', { amount: '100' }],
      ['huge amount', { amount: 1_000_000_000_000 }],
      ['unknown method', { method: 'card' }],
      ['unknown field', { status: 'void' }],
      ['bad date', { paidAt: '2026-02-30' }],
      ['cheque without details', { method: 'cheque' }],
      ['cheque details on cash', { cheque: { chequeNo: '1', bank: 'B', dueDate: '2026-12-01' } }],
    ])('rejects %s', async (_name, patchBody) => {
      const res = await pay({ doctorId: d, method: 'cash', amount: 100, ...patchBody });
      expect(res.status).toBe(400);
      expect([
        'error.validation.failed',
        'error.payment.cheque_required',
        'error.payment.cheque_not_allowed',
      ]).toContain(res.body.error.code);
    });

    it('rejects a future date, an unknown doctor, and a case of another doctor', async () => {
      const future = await pay({ doctorId: d, method: 'cash', amount: 100, paidAt: '2026-11-11' }).expect(
        400,
      );
      expect(future.body.error.code).toBe('error.payment.date_in_future');
      await pay({ doctorId: 999_999, method: 'cash', amount: 100 }).expect(404);
      const other = await doctor();
      const c = await newCase(other, 5000);
      const res = await pay({ doctorId: d, caseId: c.id, method: 'cash', amount: 100 }).expect(409);
      expect(res.body.error.code).toBe('error.payment.case_doctor_mismatch');
      await pay({ doctorId: d, caseId: 999_999, method: 'cash', amount: 100 }).expect(404);
    });

    it('creates with a gap-free voucher number and replays the same key', async () => {
      const key = randomUUID();
      const body = { doctorId: d, method: 'transfer', amount: 2500, notes: 'ref 77' };
      const first = await pay(body, key).expect(201);
      expect(first.body.payment).toMatchObject({
        status: 'active',
        counted: true,
        amount: 2500,
        method: 'transfer',
        cheque: null,
      });
      expect(first.body.payment.voucherNo).toMatch(/^IN-\d{6}$/);
      const again = await pay(body, key).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.payment.id).toBe(first.body.payment.id);
      const different = await pay({ ...body, amount: 2501 }, key).expect(422);
      expect(different.body.error.code).toBe('error.idempotency.mismatch');
      const { rows } = await t.pool.query('SELECT 1 FROM payments WHERE idempotency_key = $1', [key]);
      expect(rows).toHaveLength(1);
    });

    it('a replay after midnight still matches when the date was left out', async () => {
      const key = randomUUID();
      const body = { doctorId: d, method: 'cash', amount: 300 };
      const first = await pay(body, key).expect(201);
      clock.set('2026-11-10T23:30:00Z'); // 01:30 on the 11th in Hebron
      try {
        const again = await pay(body, key).expect(200);
        expect(again.body.payment.id).toBe(first.body.payment.id);
        expect(again.body.payment.paidAt).toBe(TODAY);
      } finally {
        clock.set(NOON);
      }
    });

    it('numbers stay unique and gap-free under parallel creates', async () => {
      const before = await t.pool.query<{ next_value: string }>(
        `SELECT next_value FROM counters WHERE name = 'payment_in_no'`,
      );
      const start = Number(before.rows[0]?.next_value);
      const responses = await Promise.all(
        Array.from({ length: 12 }, () => pay({ doctorId: d, method: 'cash', amount: 100 })),
      );
      expect(statusesOf(responses)).toEqual(Array(12).fill(201));
      const numbers = responses
        .map((r) => Number((r.body as Result).payment.voucherNo.slice(3)))
        .sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => start + i));
    });

    it('parallel requests with the same key create exactly one payment', async () => {
      const key = randomUUID();
      const body = { doctorId: d, method: 'cash', amount: 777 };
      const responses = await Promise.all(Array.from({ length: 6 }, () => pay(body, key)));
      expect(responses.map((r) => r.status).filter((s) => s === 201)).toHaveLength(1);
      expect(responses.every((r) => r.status === 201 || r.status === 200)).toBe(true);
      const { rows } = await t.pool.query('SELECT 1 FROM payments WHERE idempotency_key = $1', [key]);
      expect(rows).toHaveLength(1);
      expect(new Set(responses.map((r) => (r.body as Result).payment.id)).size).toBe(1);
    });

    it('a failed insert gives its voucher number back', async () => {
      const before = await t.pool.query<{ next_value: string }>(
        `SELECT next_value FROM counters WHERE name = 'payment_in_no'`,
      );
      await pay({ doctorId: d, method: 'cash', amount: 100, paidAt: '2026-12-01' }).expect(400);
      const after = await t.pool.query<{ next_value: string }>(
        `SELECT next_value FROM counters WHERE name = 'payment_in_no'`,
      );
      expect(after.rows[0]?.next_value).toBe(before.rows[0]?.next_value);
    });

    it('writes an audit entry with the acting user and no patient name', async () => {
      const { rows } = await t.pool.query<{
        action: string;
        user_id: string | null;
        params: Record<string, unknown>;
      }>(
        `SELECT action, user_id, params FROM audit_log WHERE action = 'payment.created' ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0]?.user_id).not.toBeNull();
      expect(rows[0]?.params).toMatchObject({ method: expect.any(String), viaAdvance: false });
      expect(JSON.stringify(rows[0]?.params)).not.toContain('Patient');
    });
  });

  describe('plan example 1 — a cheque: pending, cleared, returned', () => {
    it('moves the balance exactly as hand-calculated', async () => {
      const d = await doctor();
      const c1 = await newCase(d, 40_000, '2026-11-01');
      const c2 = await newCase(d, 30_000, '2026-11-03');
      expect((await balance(d)).balance).toBe(70_000);

      const made = await paid({ doctorId: d, method: 'cheque', amount: 50_000, cheque: cheque() });
      expect(made.payment).toMatchObject({ counted: false, cheque: { status: 'pending', dueState: 'soon' } });
      expect(made.payment.cheque?.allowedStatuses).toEqual(['cleared', 'returned']);
      expect(made.doctorBalance).toBe(70_000);
      expect(await balance(d)).toMatchObject({ balance: 70_000, received: 0, pendingCheques: 50_000 });
      expect(await caseOf(c1.id)).toMatchObject({ paid: 0, remaining: 40_000 });

      const cleared = await setCheque(
        made.payment.cheque!.id,
        made.payment.cheque!.rowVersion,
        'cleared',
      ).expect(200);
      expect(cleared.body.doctorBalance).toBe(20_000);
      expect(cleared.body.payment.counted).toBe(true);
      expect(await balance(d)).toMatchObject({ balance: 20_000, received: 50_000, pendingCheques: 0 });
      expect(await caseOf(c1.id)).toMatchObject({ paid: 40_000, remaining: 0 });
      expect(await caseOf(c2.id)).toMatchObject({ paid: 10_000, remaining: 20_000 });

      const ch = (cleared.body as Result).payment.cheque!;
      expect(ch.allowedStatuses).toEqual(['returned']);
      const returned = await setCheque(ch.id, ch.rowVersion, 'returned').expect(200);
      expect(returned.body.doctorBalance).toBe(70_000);
      expect(returned.body.payment).toMatchObject({ counted: false, status: 'active' });
      expect(returned.body.payment.cheque.allowedStatuses).toEqual([]);
      expect(await caseOf(c1.id)).toMatchObject({ paid: 0, remaining: 40_000 });

      // Returned is final; a stale version is refused first.
      const rc = (returned.body as Result).payment.cheque!;
      const back = await setCheque(rc.id, rc.rowVersion, 'cleared').expect(409);
      expect(back.body.error).toMatchObject({
        code: 'error.cheque.invalid_transition',
        params: { from: 'returned', to: 'cleared' },
      });
      const stale = await setCheque(rc.id, rc.rowVersion - 1, 'cleared').expect(409);
      expect(stale.body.error.code).toBe('error.concurrency.stale');

      // The statement shows the clearing and the bounce on their own days.
      const st = await get(`/doctors/${d}/statement`).expect(200);
      expect(st.body.lines.map((l: { kind: string }) => l.kind)).toEqual([
        'case',
        'case',
        'payment',
        'cheque_return',
      ]);
      expect(st.body.lines.at(-1).running).toBe(70_000);
      expect(st.body.closing).toBe(70_000);

      const actions = await t.pool.query<{ params: Record<string, string> }>(
        `SELECT params FROM audit_log WHERE action = 'cheque.status_changed' AND params->>'voucherNo' = $1 ORDER BY id`,
        [made.payment.voucherNo],
      );
      expect(actions.rows.map((r) => `${r.params.from}>${r.params.to}`)).toEqual([
        'pending>cleared',
        'cleared>returned',
      ]);
    });

    it('pending cheques can be returned directly; dates are validated; the register lists them', async () => {
      const d = await doctor();
      const p = await paid({
        doctorId: d,
        method: 'cheque',
        amount: 1000,
        cheque: cheque({ dueDate: '2026-11-09' }),
      });
      expect(p.payment.cheque?.dueState).toBe('overdue');
      const ch = p.payment.cheque!;
      await setCheque(ch.id, ch.rowVersion, 'cleared', { statusDate: '2026-11-11' }).expect(400);
      await setCheque(ch.id, ch.rowVersion, 'cleared', { statusDate: '2020-01-01' }).expect(400);
      const ret = await setCheque(ch.id, ch.rowVersion, 'returned', { note: 'no funds' }).expect(200);
      expect(ret.body.payment.cheque.status).toBe('returned');

      const list = await get(`/cheques?doctorId=${d}`).expect(200);
      expect(list.body.items).toHaveLength(1);
      const summary = await get(`/cheques/summary?doctorId=${d}`).expect(200);
      expect(summary.body.byStatus).toEqual({ pending: 0, cleared: 0, returned: 1 });
    });

    it('a status date may not be earlier than the current status date (B5 item 6); the statement keeps its order', async () => {
      const d = await doctor();
      await newCase(d, 2000, '2026-11-01');
      const p = await paid({ doctorId: d, method: 'cheque', amount: 1500, paidAt: '2026-11-01', cheque: cheque() });
      const ch = p.payment.cheque!;
      const cleared = (await setCheque(ch.id, ch.rowVersion, 'cleared', { statusDate: '2026-11-08' }).expect(200))
        .body as Result;
      const cc = cleared.payment.cheque!;
      // Returned "before" it cleared would put the bounce above the clearing in the statement.
      const early = await setCheque(cc.id, cc.rowVersion, 'returned', { statusDate: '2026-11-05' }).expect(400);
      expect(early.body.error.code).toBe('error.cheque.date_invalid');
      // The same day is fine.
      await setCheque(cc.id, cc.rowVersion, 'returned', { statusDate: '2026-11-08' }).expect(200);
      const st = await get(`/doctors/${d}/statement`).expect(200);
      expect(st.body.lines.map((l: { kind: string; date: string }) => `${l.date} ${l.kind}`)).toEqual([
        '2026-11-01 case',
        '2026-11-08 payment',
        '2026-11-08 cheque_return',
      ]);
      expect(st.body.closing).toBe(2000);
      expect((await balance(d)).balance).toBe(2000);
      // Every change writes its history row in the same transaction (both directions, SPEC §7.4).
      const h = await t.pool.query<{ s: string }>(
        `SELECT from_status || '>' || to_status || ' ' || status_date::text AS s FROM cheque_status_history
         WHERE cheque_id = $1 AND from_status IS NOT NULL ORDER BY id`,
        [ch.id],
      );
      expect(h.rows.map((r) => r.s)).toEqual(['pending>cleared 2026-11-08', 'cleared>returned 2026-11-08']);
    });

    it('rejects a duplicate cheque (same bank and number) until the first one is returned', async () => {
      const d = await doctor();
      const same = cheque({ chequeNo: 'DUP-1', bank: 'Arab Bank' });
      const first = await paid({ doctorId: d, method: 'cheque', amount: 100, cheque: same });
      const dup = await pay({
        doctorId: d,
        method: 'cheque',
        amount: 100,
        cheque: { ...same, bank: 'arab bank' },
      }).expect(409);
      expect(dup.body.error.code).toBe('error.cheque.duplicate');
      await setCheque(first.payment.cheque!.id, first.payment.cheque!.rowVersion, 'returned').expect(200);
      await pay({ doctorId: d, method: 'cheque', amount: 100, cheque: same }).expect(201);
    });
  });

  describe('plan example 2 — bound and unbound payments, opening balance, a cancelled case', () => {
    it('ties the per-case figures to the balance before and after the cancel', async () => {
      const d = await doctor(10_000);
      const c1 = await newCase(d, 30_000, '2026-11-01');
      const c2 = await newCase(d, 20_000, '2026-11-02');
      const c3 = await newCase(d, 15_000, '2026-11-04');
      await paid({ doctorId: d, caseId: c2.id, method: 'cash', amount: 12_000 });
      await paid({ doctorId: d, method: 'cash', amount: 25_000 });
      const bound3 = await paid({ doctorId: d, caseId: c3.id, method: 'transfer', amount: 6_000 });
      expect((await balance(d)).balance).toBe(32_000);
      expect(await caseOf(c1.id)).toMatchObject({ paid: 15_000, remaining: 15_000 });
      expect(await caseOf(c2.id)).toMatchObject({ paid: 12_000, remaining: 8_000 });
      expect(await caseOf(c3.id)).toMatchObject({ paid: 6_000, remaining: 9_000 });

      const cancelled = await post(`/cases/${c3.id}/cancel`, { rowVersion: c3.rowVersion }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'cancelled', paid: 0, remaining: 0 });
      expect((await balance(d)).balance).toBe(17_000);
      expect(await caseOf(c1.id)).toMatchObject({ paid: 21_000, remaining: 9_000 });
      expect(await caseOf(c2.id)).toMatchObject({ paid: 12_000, remaining: 8_000 });

      // Its payment stays active (account credit); new payments cannot be bound to the cancelled case.
      const still = await get(`/payments/${bound3.payment.id}`).expect(200);
      expect(still.body).toMatchObject({ status: 'active', counted: true });
      const rebind = await pay({ doctorId: d, caseId: c3.id, method: 'cash', amount: 1 }).expect(409);
      expect(rebind.body.error.code).toBe('error.payment.case_cancelled');
    });

    it('limits a bound payment to what is unpaid on the case, pending cheques included', async () => {
      const d = await doctor();
      const c = await newCase(d, 50_000);
      await paid({ doctorId: d, caseId: c.id, method: 'cheque', amount: 40_000, cheque: cheque() });
      const over = await pay({ doctorId: d, caseId: c.id, method: 'cash', amount: 10_001 }).expect(409);
      expect(over.body.error).toMatchObject({
        code: 'error.payment.exceeds_case_total',
        params: { max: 10_000 },
      });
      await paid({ doctorId: d, caseId: c.id, method: 'cash', amount: 10_000 });
      // An unbound payment has no limit: it becomes credit.
      const credit = await paid({ doctorId: d, method: 'cash', amount: 7_000 });
      expect(credit.doctorBalance).toBe(33_000);
    });

    it('overpayment is credit (owed by the lab)', async () => {
      const d = await doctor();
      await newCase(d, 10_000);
      const res = await paid({ doctorId: d, method: 'cash', amount: 15_000 });
      expect(res.doctorBalance).toBe(-5_000);
      expect(await balance(d)).toMatchObject({ direction: 'owed_by_lab' });
    });

    it('a case whose total drops below its bound payments spills the excess to the next case', async () => {
      const d = await doctor();
      const c1 = await newCase(d, 10_000, '2026-11-01');
      const c2 = await newCase(d, 20_000, '2026-11-02');
      await paid({ doctorId: d, caseId: c1.id, method: 'cash', amount: 8_000 });
      const detail = await caseOf(c1.id);
      const reduced = await patch(`/cases/${c1.id}`, {
        rowVersion: detail.rowVersion,
        discount: 5_000,
      }).expect(200);
      expect(reduced.body).toMatchObject({ total: 5_000, paid: 5_000, remaining: 0 });
      expect(await caseOf(c2.id)).toMatchObject({ paid: 3_000, remaining: 17_000 });
      expect((await balance(d)).balance).toBe(5_000 + 20_000 - 8_000);
    });
  });

  describe('voiding', () => {
    it('needs a reason, restores the balance, keeps the number, and cannot repeat', async () => {
      const d = await doctor();
      await newCase(d, 10_000);
      const p = await paid({ doctorId: d, method: 'cash', amount: 4_000 });
      expect(p.doctorBalance).toBe(6_000);
      await post(`/payments/${p.payment.id}/void`, { rowVersion: p.payment.rowVersion }).expect(400);
      await post(`/payments/${p.payment.id}/void`, {
        rowVersion: p.payment.rowVersion,
        reason: '   ',
      }).expect(400);
      await post(`/payments/${p.payment.id}/void`, { rowVersion: 99, reason: 'typo' }).expect(409);
      const voided = await post(`/payments/${p.payment.id}/void`, {
        rowVersion: p.payment.rowVersion,
        reason: 'entered twice',
      }).expect(200);
      expect(voided.body.doctorBalance).toBe(10_000);
      expect(voided.body.payment).toMatchObject({
        status: 'void',
        counted: false,
        voidReason: 'entered twice',
      });
      const again = await post(`/payments/${p.payment.id}/void`, {
        rowVersion: voided.body.payment.rowVersion,
        reason: 'again',
      }).expect(409);
      expect(again.body.error.code).toBe('error.payment.already_void');
      const next = await paid({ doctorId: d, method: 'cash', amount: 1 });
      expect(Number(next.payment.voucherNo.slice(3))).toBeGreaterThan(Number(p.payment.voucherNo.slice(3)));
      const audit = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'payment.voided' ORDER BY id DESC LIMIT 1`,
      );
      expect(audit.rows[0]?.params).toMatchObject({
        voucherNo: p.payment.voucherNo,
        reason: 'entered twice',
      });
    });

    it('voids a cleared cheque (D9) and then freezes its status', async () => {
      const d = await doctor();
      await newCase(d, 10_000);
      const p = await paid({ doctorId: d, method: 'cheque', amount: 10_000, cheque: cheque() });
      const cleared = await setCheque(p.payment.cheque!.id, p.payment.cheque!.rowVersion, 'cleared').expect(
        200,
      );
      expect(cleared.body.doctorBalance).toBe(0);
      const voided = await post(`/payments/${p.payment.id}/void`, {
        rowVersion: cleared.body.payment.rowVersion,
        reason: 'wrong doctor',
      }).expect(200);
      expect(voided.body.doctorBalance).toBe(10_000);
      expect(voided.body.payment.cheque.allowedStatuses).toEqual([]);
      const frozen = await setCheque(
        (cleared.body as Result).payment.cheque!.id,
        (cleared.body as Result).payment.cheque!.rowVersion,
        'returned',
      ).expect(409);
      expect(frozen.body.error.code).toBe('error.cheque.payment_void');
      // A void cheque leaves the register and the statement.
      const list = await get(`/cheques?doctorId=${d}`).expect(200);
      expect(list.body.items).toHaveLength(0);
      const st = await get(`/doctors/${d}/statement`).expect(200);
      expect(st.body.lines.map((l: { kind: string }) => l.kind)).toEqual(['case']);
    });

    it('only one of two parallel voids wins', async () => {
      const d = await doctor();
      const p = await paid({ doctorId: d, method: 'cash', amount: 100 });
      const body = { rowVersion: p.payment.rowVersion, reason: 'race' };
      const res = await Promise.all([
        post(`/payments/${p.payment.id}/void`, body),
        post(`/payments/${p.payment.id}/void`, body),
      ]);
      expect(statusesOf(res).sort()).toEqual([200, 409]);
    });

    it('parallel cheque status changes: one wins, the other is stale or invalid', async () => {
      const d = await doctor();
      const p = await paid({ doctorId: d, method: 'cheque', amount: 100, cheque: cheque() });
      const ch = p.payment.cheque!;
      const res = await Promise.all([
        setCheque(ch.id, ch.rowVersion, 'cleared'),
        setCheque(ch.id, ch.rowVersion, 'returned'),
      ]);
      expect(statusesOf(res).sort()).toEqual([200, 409]);
    });
  });

  describe('advance payment with a new case (atomic)', () => {
    let d: number;
    const caseBody = (extra: object = {}) => ({
      doctorId: d,
      patientName: 'Advance',
      expectedDate: '2026-12-31',
      lines: [{ toothNo: 21, workTypeId: workType, unitPrice: 30_000 }],
      ...extra,
    });
    beforeAll(async () => {
      d = await doctor();
    });

    it('creates the case and a payment bound to it, and shows paid / remaining', async () => {
      const key = randomUUID();
      const res = await post('/cases', caseBody({ advance: { method: 'cash', amount: 10_000 } }), key).expect(
        201,
      );
      expect(res.body).toMatchObject({ total: 30_000, paid: 10_000, remaining: 20_000 });
      expect(res.body.advancePayment).toMatchObject({ amount: 10_000, method: 'cash', counted: true });
      expect(res.body.advancePayment.case).toEqual({ id: res.body.id, caseNo: res.body.caseNo });
      const audit = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'payment.created' ORDER BY id DESC LIMIT 1`,
      );
      expect(audit.rows[0]?.params).toMatchObject({ viaAdvance: true, caseNo: res.body.caseNo });
      const panel = await get(`/cases/${res.body.id}/payments`).expect(200);
      expect(panel.body).toMatchObject({ total: 30_000, paid: 10_000, remaining: 20_000 });
      expect(panel.body.payments).toHaveLength(1);

      const replay = await post(
        '/cases',
        caseBody({ advance: { method: 'cash', amount: 10_000 } }),
        key,
      ).expect(200);
      expect(replay.body.id).toBe(res.body.id);
    });

    it('a replay of the very same request returns the original case', async () => {
      const key = randomUUID();
      const body = caseBody({ patientName: 'Replay', advance: { method: 'transfer', amount: 5_000 } });
      const first = await post('/cases', body, key).expect(201);
      const again = await post('/cases', body, key).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.advancePayment.id).toBe(first.body.advancePayment.id);
      const { rows } = await t.pool.query('SELECT 1 FROM cases WHERE patient_name = $1', ['Replay']);
      expect(rows).toHaveLength(1);
      const different = await post('/cases', { ...body, notes: 'changed' }, key).expect(422);
      expect(different.body.error.code).toBe('error.idempotency.mismatch');
    });

    it('needs a key; a plain case without advance needs none', async () => {
      const res = await post('/cases', caseBody({ advance: { method: 'cash', amount: 1 } })).expect(400);
      expect(res.body.error.code).toBe('error.idempotency.required');
      const plain = await post('/cases', caseBody({ patientName: 'Plain' })).expect(201);
      expect(plain.body.advancePayment).toBeNull();
    });

    it('rolls everything back, numbers included, when the advance is refused', async () => {
      const counters = async () =>
        (
          await t.pool.query<{ name: string; next_value: string }>(
            `SELECT name, next_value FROM counters WHERE name IN ('case_no','payment_in_no') ORDER BY name`,
          )
        ).rows.map((r) => `${r.name}=${r.next_value}`);
      const before = await counters();
      const casesBefore = (await t.pool.query('SELECT 1 FROM cases')).rowCount;

      const tooBig = await post(
        '/cases',
        caseBody({ patientName: 'TooBig', advance: { method: 'cash', amount: 30_001 } }),
        randomUUID(),
      ).expect(409);
      expect(tooBig.body.error.code).toBe('error.payment.exceeds_case_total');
      const noCheque = await post(
        '/cases',
        caseBody({ patientName: 'NoCheque', advance: { method: 'cheque', amount: 100 } }),
        randomUUID(),
      ).expect(400);
      expect(noCheque.body.error.code).toBe('error.payment.cheque_required');
      const future = await post(
        '/cases',
        caseBody({ patientName: 'Future', advance: { method: 'cash', amount: 100, paidAt: '2026-11-11' } }),
        randomUUID(),
      ).expect(400);
      expect(future.body.error.code).toBe('error.payment.date_in_future');

      expect(await counters()).toEqual(before);
      expect((await t.pool.query('SELECT 1 FROM cases')).rowCount).toBe(casesBefore);
      expect(
        (await t.pool.query(`SELECT 1 FROM cases WHERE patient_name IN ('TooBig','NoCheque','Future')`))
          .rowCount,
      ).toBe(0);
    });

    it('creates a pending cheque advance with its cheque row', async () => {
      const res = await post(
        '/cases',
        caseBody({
          patientName: 'ChequeAdv',
          advance: { method: 'cheque', amount: 8_000, cheque: cheque() },
        }),
        randomUUID(),
      ).expect(201);
      expect(res.body.advancePayment).toMatchObject({ counted: false, cheque: { status: 'pending' } });
      expect(res.body).toMatchObject({ paid: 0, remaining: 30_000 });
    });
  });

  describe('cancelling a returned case with payments (D2)', () => {
    it('keeps the payments as credit and records the amounts in the audit entry', async () => {
      const d = await doctor();
      const c = await newCase(d, 20_000);
      await paid({ doctorId: d, caseId: c.id, method: 'cash', amount: 5_000 });
      let cur = (
        await post(`/cases/${c.id}/status`, { rowVersion: c.rowVersion, to: 'delivered' }).expect(200)
      ).body as CaseBody;
      cur = (await post(`/cases/${c.id}/status`, { rowVersion: cur.rowVersion, to: 'returned' }).expect(200))
        .body as CaseBody;
      const done = await post(`/cases/${c.id}/cancel`, {
        rowVersion: cur.rowVersion,
        reason: 'abandoned',
      }).expect(200);
      expect(done.body.status).toBe('cancelled');
      expect(await balance(d)).toMatchObject({ balance: -5_000, direction: 'owed_by_lab' });
      const audit = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'case.cancelled' AND entity_id = $1`,
        [String(c.id)],
      );
      expect(audit.rows[0]?.params).toMatchObject({
        fromStatus: 'returned',
        total: 20_000,
        boundPayments: 5_000,
      });
    });
  });

  describe('lists, debts and the Home summary', () => {
    it('filters, searches and totals payments', async () => {
      const d = await doctor();
      const p1 = await paid({ doctorId: d, method: 'cash', amount: 1_000, paidAt: '2026-11-02' });
      await paid({
        doctorId: d,
        method: 'cheque',
        amount: 2_000,
        paidAt: '2026-11-03',
        cheque: cheque({ chequeNo: 'FIND-ME' }),
      });
      const v = await paid({ doctorId: d, method: 'transfer', amount: 4_000, paidAt: '2026-11-04' });
      await post(`/payments/${v.payment.id}/void`, { rowVersion: v.payment.rowVersion, reason: 'x' }).expect(
        200,
      );

      const all = await get(`/payments?doctorId=${d}`).expect(200);
      expect(all.body.items.map((p: PaymentBody) => p.amount)).toEqual([4_000, 2_000, 1_000]); // newest first
      expect(all.body.totals).toEqual({ counted: 1_000, pendingCheques: 2_000 });
      expect((await get(`/payments?doctorId=${d}&method=cheque`).expect(200)).body.total).toBe(1);
      expect((await get(`/payments?doctorId=${d}&status=void`).expect(200)).body.total).toBe(1);
      expect((await get(`/payments?doctorId=${d}&counted=true`).expect(200)).body.total).toBe(1);
      expect(
        (await get(`/payments?doctorId=${d}&from=2026-11-03&to=2026-11-03`).expect(200)).body.total,
      ).toBe(1);
      expect((await get(`/payments?search=FIND-ME`).expect(200)).body.total).toBe(1);
      expect((await get(`/payments?search=${p1.payment.voucherNo}`).expect(200)).body.items[0].id).toBe(
        p1.payment.id,
      );
      expect((await get(`/payments?pageSize=1&page=2&doctorId=${d}`).expect(200)).body.items).toHaveLength(1);
      await get('/payments?pageSize=101').expect(400);
      const one = await get(`/payments/${p1.payment.id}`).expect(200);
      expect(one.body.chequeHistory).toEqual([]);
    });

    it('debts: summary figures tie to the doctors, filters and search work', async () => {
      const fresh = await startTestApp({}, { clock });
      try {
        const h = (m: 'post' | 'get', path: string, body?: object, key?: string) => {
          const r = request(fresh.http)[m](`/api/v1${path}`).set('Authorization', fresh.auth);
          return (key ? r.set('Idempotency-Key', key) : r).send(body);
        };
        const w = (await h('post', '/work-types', { name: 'Crown', unitPrice: 10_000 })).body.id as number;
        const mk = async (name: string, opening: number) =>
          (await h('post', '/doctors', { name, openingBalance: opening })).body.id as number;
        const a = await mk('Alpha', 0);
        const b = await mk('Bravo', 0);
        await mk('Settled', 0);
        for (const [doc, price] of [
          [a, 30_000],
          [b, 10_000],
        ] as const) {
          await h('post', '/cases', {
            doctorId: doc,
            patientName: 'P',
            expectedDate: '2026-12-31',
            lines: [{ toothNo: 11, workTypeId: w, unitPrice: price }],
          });
        }
        await h('post', '/payments', { doctorId: b, method: 'cash', amount: 25_000 }, randomUUID());
        const debts = await h('get', '/debts');
        expect(debts.body.summary).toEqual({ parties: 2, owedToLab: 30_000, owedByLab: 15_000, net: 15_000 });
        expect(
          debts.body.items.map((i: { doctor: { name: string }; balance: number }) => [
            i.doctor.name,
            i.balance,
          ]),
        ).toEqual([
          ['Alpha', 30_000],
          ['Bravo', -15_000],
        ]);
        expect((await h('get', '/debts?direction=owed_by_lab')).body.items).toHaveLength(1);
        expect((await h('get', '/debts?direction=owed_to_lab&search=alp')).body.items).toHaveLength(1);
        expect((await h('get', '/debts?search=zzz')).body.items).toHaveLength(0);
        const home = await h('get', '/ledger/summary');
        expect(home.body).toEqual({
          receivedThisMonth: 25_000,
          receivedTotal: 25_000,
          owedToLab: 30_000,
          pendingChequesCount: 0,
          pendingChequesAmount: 0,
          chequesDueSoon: 0,
          chequesOverdue: 0,
          // B4b: no outgoing money in this installation.
          outgoingThisMonth: 0,
          outgoingTotal: 0,
          outgoingChequesDueSoon: 0,
          outgoingChequesOverdue: 0,
        });
        // Cheques: pending soon / overdue / later, and the cleared one counts on the day it cleared.
        const ck = async (due: string, amount: number) =>
          (
            (
              await h(
                'post',
                '/payments',
                {
                  doctorId: a,
                  method: 'cheque',
                  amount,
                  cheque: { chequeNo: `N${amount}`, bank: 'B', dueDate: due },
                },
                randomUUID(),
              )
            ).body as Result
          ).payment;
        await ck('2026-11-08', 100); // overdue
        await ck('2026-11-12', 200); // soon
        await ck('2026-12-30', 400); // later
        const clearMe = await ck('2026-11-20', 800);
        await request(fresh.http)
          .patch(`/api/v1/cheques/${clearMe.cheque!.id}/status`)
          .set('Authorization', fresh.auth)
          .send({ rowVersion: clearMe.cheque!.rowVersion, status: 'cleared' })
          .expect(200);
        const home2 = (await h('get', '/ledger/summary')).body;
        expect(home2).toMatchObject({
          receivedThisMonth: 25_800,
          pendingChequesCount: 3,
          pendingChequesAmount: 700,
          chequesDueSoon: 1,
          chequesOverdue: 1,
        });
        const chips = (await h('get', '/cheques/summary')).body;
        expect(chips).toMatchObject({
          byStatus: { pending: 3, cleared: 1, returned: 0 },
          dueSoon: 1,
          overdue: 1,
          pendingAmount: 700,
        });
        expect((await h('get', '/cheques?due=overdue')).body.items).toHaveLength(1);
        expect((await h('get', '/cheques?due=soon')).body.items).toHaveLength(1);
        const ordered = (await h('get', '/cheques')).body.items.map((p: PaymentBody) => p.amount);
        expect(ordered).toEqual([100, 200, 800, 400]); // by due date
      } finally {
        await fresh.close();
      }
    });

    it('statement: opening balance, running balance, paging and a date range', async () => {
      const d = await doctor(5_000);
      await newCase(d, 10_000, '2026-11-01');
      await paid({ doctorId: d, method: 'cash', amount: 4_000, paidAt: '2026-11-05' });
      await newCase(d, 2_000, '2026-11-08');
      const st = await get(`/doctors/${d}/statement`).expect(200);
      expect(st.body).toMatchObject({
        openingBalance: 5_000,
        periodOpening: 5_000,
        closing: 13_000,
        total: 3,
      });
      expect(st.body.lines.map((l: { running: number }) => l.running)).toEqual([15_000, 11_000, 13_000]);
      const ranged = await get(`/doctors/${d}/statement?from=2026-11-05&to=2026-11-07`).expect(200);
      expect(ranged.body).toMatchObject({ periodOpening: 15_000, closing: 11_000, total: 1 });
      const paged = await get(`/doctors/${d}/statement?pageSize=1&page=3`).expect(200);
      expect(paged.body.lines).toHaveLength(1);
      expect(paged.body.lines[0].running).toBe(13_000);
      await get('/doctors/999999/statement').expect(404);
      await get('/doctors/999999/balance').expect(404);
    });
  });
});
