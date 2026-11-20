import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { FakeClock, startTestApp, statusesOf, TestApp } from '../support/app';

jest.setTimeout(300_000);

/** 2026-11-10 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-10T10:00:00Z';
const TODAY = '2026-11-10';

interface ChequeBody {
  id: number;
  status: string;
  statusDate: string | null;
  rowVersion: number;
  allowedStatuses: string[];
}
interface OutBody {
  id: number;
  voucherNo: string;
  kind: string;
  amount: number;
  status: string;
  counted: boolean;
  effectiveDate: string | null;
  rowVersion: number;
  payee: string | null;
  doctor: { id: number; name: string } | null;
  category: { id: number; name: string };
  voidReason: string | null;
  cheque: ChequeBody | null;
}
interface OutResult {
  payment: OutBody;
  doctorBalance: number | null;
}
interface Balance {
  balance: number;
  received: number;
  paidOut: number;
  charges: number;
  pendingRefundCheques: number;
  refundable: number;
}

/**
 * B4b outgoing payments through the real HTTP API: expenses, refunds of a doctor's credit, OUT- vouchers,
 * outgoing cheques, void, idempotency across both tables, locks, permissions and audit
 * (docs/plans/b4b-outgoing-expenses.md §2–§3, worked examples R1–R7).
 */
describe('Outgoing payments and refunds (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (path: string) => `/api/v1${path}`;
  const as = (auth: string) => ({
    post: (path: string, body: object, key?: string) => {
      const r = request(t.http).post(api(path)).set('Authorization', auth);
      return (key ? r.set('Idempotency-Key', key) : r).send(body);
    },
    patch: (path: string, body: object) => request(t.http).patch(api(path)).set('Authorization', auth).send(body),
    get: (path: string) => request(t.http).get(api(path)).set('Authorization', auth),
    del: (path: string) => request(t.http).delete(api(path)).set('Authorization', auth),
  });
  const owner = () => as(t.auth);
  const post = (path: string, body: object, key?: string) => owner().post(path, body, key);
  const patch = (path: string, body: object) => owner().patch(path, body);
  const get = (path: string) => owner().get(path);

  let ownerId: number;
  /** A valid token with exactly these permissions (for the mixed-permission checks). */
  const tokenWith = async (...perms: string[]) =>
    `Bearer ${await new JwtService({ secret: t.config.jwt.accessSecret }).signAsync(
      { sub: String(ownerId), perms: ['account.self', ...perms] },
      { algorithm: 'HS256', expiresIn: 600 },
    )}`;

  let rent: number;
  let refundCat: number;
  let workType: number;
  let seq = 0;

  const doctor = async (opening = 0) =>
    (await post('/doctors', { name: `Dr ${++seq}-${randomUUID().slice(0, 6)}`, openingBalance: opening }).expect(201))
      .body.id as number;
  const newCase = async (doctorId: number, price: number, receivedDate = TODAY) =>
    (
      await post('/cases', {
        doctorId,
        patientName: 'P',
        receivedDate,
        expectedDate: '2026-12-31',
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      }).expect(201)
    ).body as { id: number };
  const payIn = async (body: object) =>
    (await post('/payments', body, randomUUID()).expect(201)).body as {
      payment: { id: number; cheque: ChequeBody | null; rowVersion: number };
    };
  const out = (body: object, key: string = randomUUID()) => post('/outgoing-payments', body, key);
  const outOk = async (body: object) => (await out(body).expect(201)).body as OutResult;
  const expense = (extra: object = {}) => ({ categoryId: rent, payee: 'Landlord', method: 'cash', amount: 150000, ...extra });
  const refund = (doctorId: number, amount: number, extra: object = {}) => ({
    categoryId: refundCat,
    doctorId,
    method: 'cash',
    amount,
    ...extra,
  });
  const balance = async (doctorId: number) => (await get(`/doctors/${doctorId}/balance`).expect(200)).body as Balance;
  const cheque = (extra: object = {}) => ({ chequeNo: `O-${++seq}`, bank: 'Lab Bank', dueDate: '2026-11-15', ...extra });
  const setOutCheque = (chequeId: number, rowVersion: number, status: string, extra: object = {}) =>
    patch(`/outgoing-cheques/${chequeId}/status`, { rowVersion, status, ...extra });
  const setInCheque = (chequeId: number, rowVersion: number, status: string, extra: object = {}) =>
    patch(`/cheques/${chequeId}/status`, { rowVersion, status, ...extra });
  const tieOut = async (doctorId: number) => {
    const b = (await get(`/doctors/${doctorId}/debt-breakdown?pageSize=100`).expect(200)).body as {
      tieOut: { openingRemaining: number; casesRemaining: number; refundsRemaining: number; credit: number; balance: number };
      openRefunds: { voucherNo: string; remaining: number; covered: number }[];
    };
    const st = (await get(`/doctors/${doctorId}/statement?pageSize=100`).expect(200)).body as {
      closing: number;
      lines: { kind: string; voucher: string | null; debit: number; credit: number }[];
    };
    const bal = await balance(doctorId);
    const eq = b.tieOut.openingRemaining + b.tieOut.casesRemaining + b.tieOut.refundsRemaining - b.tieOut.credit;
    expect({ eq, header: b.tieOut.balance, closing: st.closing }).toEqual({
      eq: bal.balance,
      header: bal.balance,
      closing: bal.balance,
    });
    return { b, st, bal };
  };

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    ownerId = (await get('/auth/me').expect(200)).body.id as number;
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', { rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' }).expect(200);
    const cats = (await get('/expense-categories?pageSize=100').expect(200)).body.items as {
      id: number;
      isDoctor: boolean;
    }[];
    refundCat = cats.find((c) => c.isDoctor)?.id as number;
    rent = cats.find((c) => !c.isDoctor)?.id as number;
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('currency lock (runs first, while no amount exists)', () => {
    it('an outgoing payment alone locks the currency code and decimals', async () => {
      const before = await get('/settings').expect(200);
      expect(before.body.currency.locked).toEqual({ code: false, decimals: false });
      const first = await outOk(expense({ amount: 1000 }));
      expect(first.payment.voucherNo).toBe('OUT-000001');
      const after = await get('/settings').expect(200);
      expect(after.body.currency.locked).toEqual({ code: true, decimals: true });
      const res = await patch('/settings/currency', { rowVersion: after.body.currency.rowVersion, decimals: 3 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.settings.currency_locked');
    });

    it('an outgoing payment racing a currency change never stores an amount under changed decimals', async () => {
      const fresh = await startTestApp({}, { clock });
      try {
        const cats = (
          await request(fresh.http).get('/api/v1/expense-categories').set('Authorization', fresh.auth).expect(200)
        ).body.items as { id: number; isDoctor: boolean }[];
        const s = await request(fresh.http).get('/api/v1/settings').set('Authorization', fresh.auth).expect(200);
        const [cur, created] = await Promise.all([
          request(fresh.http)
            .patch('/api/v1/settings/currency')
            .set('Authorization', fresh.auth)
            .send({ rowVersion: s.body.currency.rowVersion, decimals: 3 }),
          request(fresh.http)
            .post('/api/v1/outgoing-payments')
            .set('Authorization', fresh.auth)
            .set('Idempotency-Key', randomUUID())
            .send({ categoryId: cats.find((c) => !c.isDoctor)?.id, payee: 'X', method: 'cash', amount: 100 }),
        ]);
        expect(created.status).toBe(201);
        const { rows } = await fresh.pool.query<{ decimals: number }>(
          `SELECT (value->>'decimals')::int AS decimals FROM settings WHERE key = 'currency'`,
        );
        expect(cur.status === 200 ? rows[0]?.decimals === 3 : rows[0]?.decimals === 2).toBe(true);
        const codes = await fresh.pool.query<{ code: string }>('SELECT currency_code AS code FROM outgoing_payments');
        expect(codes.rows.every((r) => r.code === 'ILS')).toBe(true);
      } finally {
        await fresh.close();
      }
    });
  });

  describe('setup', () => {
    it('creates the work type used by the cases below', async () => {
      workType = (await post('/work-types', { name: 'Crown', unitPrice: 10000 }).expect(201)).body.id as number;
    });
  });

  describe('expenses', () => {
    it('records a cash expense: OUT- voucher, counted at once, no doctor balance, audited', async () => {
      const r = await outOk(expense({ notes: 'November rent' }));
      expect(r.payment).toMatchObject({
        voucherNo: 'OUT-000002',
        kind: 'expense',
        payee: 'Landlord',
        doctor: null,
        amount: 150000,
        status: 'active',
        counted: true,
        effectiveDate: TODAY,
        cheque: null,
      });
      expect(r.doctorBalance).toBeNull();
      const audit = await t.pool.query<{ action: string; user_id: string; params: Record<string, unknown> }>(
        `SELECT action, user_id::text, params FROM audit_log WHERE entity = 'outgoing_payment' AND entity_id = $1`,
        [r.payment.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ action: 'outgoing.created', user_id: String(ownerId) });
      expect(audit.rows[0]?.params).toMatchObject({ voucherNo: 'OUT-000002', kind: 'expense', party: 'Landlord' });
      expect(JSON.stringify(audit.rows[0]?.params)).not.toContain('November rent'); // notes are never audited
    });

    it.each([
      ['no payee', { payee: undefined }, 400, 'error.outgoing.payee_required'],
      ['a doctor on an expense', { doctorId: 1 }, 400, 'error.outgoing.doctor_not_allowed'],
      ['cheque without details', { method: 'cheque' }, 400, 'error.payment.cheque_required'],
      ['cheque details on cash', { cheque: { chequeNo: '1', bank: 'B', dueDate: TODAY } }, 400, 'error.payment.cheque_not_allowed'],
      ['a future date', { paidAt: '2026-11-11' }, 400, 'error.payment.date_in_future'],
      ['amount 0', { amount: 0 }, 400, 'error.validation.failed'],
      ['a float amount', { amount: 10.5 }, 400, 'error.validation.failed'],
      ['an unknown field', { isDoctor: true }, 400, 'error.validation.failed'],
      ['an unknown category', { categoryId: 999999 }, 404, 'error.not_found'],
    ])('rejects %s', async (_l, extra, status, code) => {
      const body: Record<string, unknown> = { ...expense(), ...extra };
      for (const [k, v] of Object.entries(extra)) if (v === undefined) delete body[k];
      const res = await out(body);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });

    it('answers validation errors in Arabic and English', async () => {
      const ar = await post('/outgoing-payments', { ...expense(), payee: undefined }, randomUUID()).set('Accept-Language', 'ar');
      expect(ar.body.error.message).toBe('اكتب اسم الجهة المستفيدة.');
      const en = await post('/outgoing-payments', { ...expense(), payee: undefined }, randomUUID()).set('Accept-Language', 'en');
      expect(en.body.error.message).toBe('Enter who was paid (the payee).');
    });

    it('refuses a deactivated category; deleting a used category deactivates it', async () => {
      const cat = (await post('/expense-categories', { name: `Gas ${++seq}` }).expect(201)).body as { id: number };
      await outOk(expense({ categoryId: cat.id, amount: 500 }));
      const del = await owner().del(`/expense-categories/${cat.id}`);
      expect(del.status).toBeLessThan(300);
      expect(JSON.stringify(del.body)).toContain('deactivated');
      const row = await t.pool.query(`SELECT active FROM expense_categories WHERE id = $1`, [cat.id]);
      expect(row.rows[0]).toEqual({ active: false });
      const res = await out(expense({ categoryId: cat.id }));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.outgoing.category_inactive');
    });

    it('the refund category can still be neither deleted nor deactivated', async () => {
      const res = await owner().del(`/expense-categories/${refundCat}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.expense_category.system');
    });
  });

  describe('idempotency, across both payment tables', () => {
    it('requires a key; a replay returns the original (200); another body with the same key is 422', async () => {
      const missing = await post('/outgoing-payments', expense());
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('error.idempotency.required');
      const key = randomUUID();
      const first = await out(expense({ amount: 777 }), key).expect(201);
      const again = await out(expense({ amount: 777 }), key).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body).toEqual(first.body);
      const other = await out(expense({ amount: 778 }), key);
      expect(other.status).toBe(422);
      expect(other.body.error.code).toBe('error.idempotency.mismatch');
    });

    it('a key used for an incoming payment cannot create an outgoing one, and the reverse', async () => {
      const d = await doctor();
      const k1 = randomUUID();
      await post('/payments', { doctorId: d, method: 'cash', amount: 100 }, k1).expect(201);
      const a = await out(expense(), k1);
      expect(a.status).toBe(422);
      expect(a.body.error.code).toBe('error.idempotency.mismatch');
      const k2 = randomUUID();
      await out(expense({ amount: 99 }), k2).expect(201);
      const b = await post('/payments', { doctorId: d, method: 'cash', amount: 100 }, k2);
      expect(b.status).toBe(422);
      const c = await post(
        '/cases',
        {
          doctorId: d,
          patientName: 'P',
          expectedDate: '2026-12-31',
          lines: [{ toothNo: 11, workTypeId: workType, unitPrice: 1000 }],
          advance: { method: 'cash', amount: 100 },
        },
        k2,
      );
      expect(c.status).toBe(422);
    });

    it('parallel requests with one key create one row', async () => {
      const key = randomUUID();
      const before = await t.pool.query(`SELECT count(*)::int AS n FROM outgoing_payments`);
      const res = await Promise.all(Array.from({ length: 5 }, () => out(expense({ amount: 4242 }), key)));
      expect(statusesOf(res).filter((s) => s === 201)).toHaveLength(1);
      expect(statusesOf(res).every((s) => s === 200 || s === 201)).toBe(true);
      const after = await t.pool.query(`SELECT count(*)::int AS n FROM outgoing_payments`);
      expect(after.rows[0].n - before.rows[0].n).toBe(1);
    });
  });

  describe('numbering', () => {
    it('parallel creates get gap-free OUT- numbers; the IN- series is independent', async () => {
      const inBefore = await t.pool.query(`SELECT next_value FROM counters WHERE name = 'payment_in_no'`);
      const outBefore = await t.pool.query<{ next_value: string }>(`SELECT next_value FROM counters WHERE name = 'payment_out_no'`);
      const res = await Promise.all(Array.from({ length: 8 }, (_, i) => out(expense({ amount: 100 + i }))));
      expect(res.every((r) => r.status === 201)).toBe(true);
      const start = Number(outBefore.rows[0]?.next_value);
      const nos = res.map((r) => Number((r.body as OutResult).payment.voucherNo.slice(4))).sort((a, b) => a - b);
      expect(nos).toEqual(Array.from({ length: 8 }, (_, i) => start + i));
      const inAfter = await t.pool.query(`SELECT next_value FROM counters WHERE name = 'payment_in_no'`);
      expect(inAfter.rows).toEqual(inBefore.rows);
    });

    it('a refused refund takes no number', async () => {
      const d = await doctor();
      await newCase(d, 10000);
      const before = await t.pool.query(`SELECT next_value FROM counters WHERE name = 'payment_out_no'`);
      const res = await out(refund(d, 100));
      expect(res.status).toBe(409);
      const after = await t.pool.query(`SELECT next_value FROM counters WHERE name = 'payment_out_no'`);
      expect(after.rows).toEqual(before.rows);
    });
  });

  describe('refunds (R1–R7)', () => {
    /** Doctor F: case 100.00, cash 150.00 unbound → credit 50.00. */
    const overpaid = async () => {
      const d = await doctor();
      await newCase(d, 10000, '2026-11-01');
      await payIn({ doctorId: d, method: 'cash', amount: 15000, paidAt: '2026-11-02' });
      return d;
    };

    it('R1 — a full refund of the credit settles the doctor; statement and breakdown tie out', async () => {
      const d = await overpaid();
      expect(await balance(d)).toMatchObject({ balance: -5000, refundable: 5000, paidOut: 0 });
      const r = await outOk(refund(d, 5000, { paidAt: '2026-11-05' }));
      expect(r.payment).toMatchObject({ kind: 'doctor_refund', payee: null, doctor: { id: d }, counted: true });
      expect(r.doctorBalance).toBe(0);
      expect(await balance(d)).toMatchObject({ balance: 0, paidOut: 5000, refundable: 0, received: 15000, charges: 10000 });
      const { st, b } = await tieOut(d);
      expect(b.openRefunds).toEqual([]);
      expect(st.lines.map((l) => [l.kind, l.debit, l.credit])).toEqual([
        ['case', 10000, 0],
        ['payment', 0, 15000],
        ['refund', 5000, 0],
      ]);
      expect(st.lines[2]?.voucher).toBe(r.payment.voucherNo);
    });

    it('R2 — a partial refund leaves the rest refundable', async () => {
      const d = await overpaid();
      await outOk(refund(d, 3000));
      expect(await balance(d)).toMatchObject({ balance: -2000, refundable: 2000 });
      await tieOut(d);
    });

    it('X2 — a refund above the refundable credit is refused with the maximum', async () => {
      const d = await overpaid();
      const res = await out(refund(d, 5001));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.outgoing.refund_exceeds_credit');
      expect(res.body.error.params).toMatchObject({ max: 5000 });
    });

    it('R3 — a refund, then the doctor’s own cheque bounces: he owes the case and the refund', async () => {
      const d = await doctor();
      await newCase(d, 20000, '2026-11-01');
      const chq = await payIn({
        doctorId: d,
        method: 'cheque',
        amount: 30000,
        paidAt: '2026-11-02',
        cheque: { chequeNo: `R3-${++seq}`, bank: 'Doctor Bank', dueDate: '2026-11-03' },
      });
      const cleared = (await setInCheque(chq.payment.cheque!.id, chq.payment.cheque!.rowVersion, 'cleared', { statusDate: '2026-11-03' }).expect(200))
        .body as { payment: { cheque: ChequeBody } };
      expect((await balance(d)).balance).toBe(-10000);
      const r = await outOk(refund(d, 10000, { paidAt: '2026-11-05' }));
      expect(r.doctorBalance).toBe(0);
      // His cheque comes back: the refund is no longer covered.
      await setInCheque(cleared.payment.cheque.id, cleared.payment.cheque.rowVersion, 'returned', { statusDate: '2026-11-10' }).expect(200);
      const { b, st, bal } = await tieOut(d);
      expect(bal.balance).toBe(30000);
      expect(b.tieOut).toMatchObject({ casesRemaining: 20000, refundsRemaining: 10000, credit: 0 });
      expect(b.openRefunds).toEqual([expect.objectContaining({ voucherNo: r.payment.voucherNo, covered: 0, remaining: 10000 })]);
      expect(st.lines.map((l) => l.kind)).toEqual(['case', 'payment', 'refund', 'cheque_return']);
      const debts = (await get('/debts?direction=owed_to_lab&pageSize=100').expect(200)).body.items as {
        doctor: { id: number };
        balance: number;
      }[];
      expect(debts.find((x) => x.doctor.id === d)?.balance).toBe(30000);
      // And nothing is refundable any more.
      expect((await out(refund(d, 1))).status).toBe(409);
    });

    it('R4 — a refund cheque: pending reserves the credit, cleared counts, returned gives it back', async () => {
      const d = await overpaid();
      const r = await outOk(refund(d, 5000, { method: 'cheque', paidAt: '2026-11-05', cheque: cheque() }));
      expect(r.payment.counted).toBe(false);
      expect(await balance(d)).toMatchObject({ balance: -5000, pendingRefundCheques: 5000, refundable: 0 });
      expect((await out(refund(d, 1))).status).toBe(409); // reserved
      const c1 = (await setOutCheque(r.payment.cheque!.id, r.payment.cheque!.rowVersion, 'cleared', { statusDate: '2026-11-08' }).expect(200))
        .body as OutResult;
      expect(c1.payment).toMatchObject({ counted: true, effectiveDate: '2026-11-08' });
      expect(c1.doctorBalance).toBe(0);
      await tieOut(d);
      const c2 = (await setOutCheque(c1.payment.cheque!.id, c1.payment.cheque!.rowVersion, 'returned', { statusDate: '2026-11-09' }).expect(200))
        .body as OutResult;
      expect(c2.doctorBalance).toBe(-5000);
      expect(await balance(d)).toMatchObject({ refundable: 5000, pendingRefundCheques: 0 });
      const { st } = await tieOut(d);
      expect(st.lines.map((l) => l.kind)).toEqual(['case', 'payment', 'refund', 'refund_cheque_return']);
    });

    it('R5 — a refund dated before a later case is paid first; the later case stays open', async () => {
      const d = await doctor();
      await newCase(d, 10000, '2026-11-01');
      await payIn({ doctorId: d, method: 'cash', amount: 15000, paidAt: '2026-11-02' });
      await outOk(refund(d, 5000, { paidAt: '2026-11-05' }));
      clock.set('2026-11-10T10:00:00Z');
      await newCase(d, 7000, '2026-11-10');
      const { b, bal } = await tieOut(d);
      expect(bal.balance).toBe(7000);
      expect(b.tieOut).toMatchObject({ casesRemaining: 7000, refundsRemaining: 0 });
    });

    it('R7 — a doctor who owes money has nothing to refund', async () => {
      const d = await doctor(10000);
      const res = await out(refund(d, 1));
      expect(res.status).toBe(409);
      expect(res.body.error.params).toMatchObject({ max: 0 });
    });

    it('refund party rules', async () => {
      const d = await doctor();
      expect((await out({ categoryId: refundCat, method: 'cash', amount: 1 })).body.error.code).toBe('error.outgoing.doctor_required');
      expect((await out({ ...refund(d, 1), payee: 'X' })).body.error.code).toBe('error.outgoing.payee_not_allowed');
      expect((await out(refund(999999, 1))).status).toBe(404);
    });

    it('two parallel refunds of the same credit: one wins, the other is refused', async () => {
      const d = await overpaid();
      const res = await Promise.all([out(refund(d, 5000)), out(refund(d, 5000))]);
      expect(statusesOf(res)).toEqual([201, 409]);
      expect((await balance(d)).balance).toBe(0);
    });

    it('a refund racing the void of the payment that made the credit: never a negative refundable at commit', async () => {
      const d = await doctor();
      await newCase(d, 10000, '2026-11-01');
      const p = await payIn({ doctorId: d, method: 'cash', amount: 15000 });
      const [r, v] = await Promise.all([
        out(refund(d, 5000)),
        post(`/payments/${p.payment.id}/void`, { rowVersion: p.payment.rowVersion, reason: 'mistake' }),
      ]);
      expect(v.status).toBe(200);
      const bal = await balance(d);
      // Either the refund went first (then the void leaves it uncovered: debt on the refund line) or it was refused.
      if (r.status === 201) expect(bal.balance).toBe(15000);
      else {
        expect(r.status).toBe(409);
        expect(bal.balance).toBe(10000);
      }
      await tieOut(d);
    });
  });

  describe('void', () => {
    it('voids with a reason, never deletes; already void is 409; a stale version is 409', async () => {
      const r = await outOk(expense({ amount: 3333 }));
      const stale = await post(`/outgoing-payments/${r.payment.id}/void`, { rowVersion: r.payment.rowVersion + 1, reason: 'x' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('error.concurrency.stale');
      const v = (await post(`/outgoing-payments/${r.payment.id}/void`, { rowVersion: r.payment.rowVersion, reason: 'typo' }).expect(200))
        .body as OutResult;
      expect(v.payment).toMatchObject({ status: 'void', voidReason: 'typo', counted: false, effectiveDate: null });
      const again = await post(`/outgoing-payments/${r.payment.id}/void`, { rowVersion: v.payment.rowVersion, reason: 'x' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('error.outgoing.already_void');
      expect((await get(`/outgoing-payments/${r.payment.id}`).expect(200)).body.status).toBe('void');
      const audit = await t.pool.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity = 'outgoing_payment' AND entity_id = $1 ORDER BY id`, [r.payment.id]);
      expect(audit.rows.map((x) => x.action)).toEqual(['outgoing.created', 'outgoing.voided']);
    });

    it('voiding a refund gives the credit back', async () => {
      const d = await doctor();
      await newCase(d, 10000);
      await payIn({ doctorId: d, method: 'cash', amount: 15000 });
      const r = await outOk(refund(d, 5000));
      const v = (await post(`/outgoing-payments/${r.payment.id}/void`, { rowVersion: r.payment.rowVersion, reason: 'cancelled' }).expect(200))
        .body as OutResult;
      expect(v.doctorBalance).toBe(-5000);
      expect((await balance(d)).refundable).toBe(5000);
      await tieOut(d);
    });

    it('a voided outgoing cheque is frozen', async () => {
      const r = await outOk(expense({ method: 'cheque', cheque: cheque(), amount: 800 }));
      const v = (await post(`/outgoing-payments/${r.payment.id}/void`, { rowVersion: r.payment.rowVersion, reason: 'lost' }).expect(200))
        .body as OutResult;
      expect(v.payment.cheque?.allowedStatuses).toEqual([]);
      const res = await setOutCheque(v.payment.cheque!.id, v.payment.cheque!.rowVersion, 'cleared');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.cheque.payment_void');
    });
  });

  describe('outgoing cheques and the register', () => {
    it('status rules: invalid transition 409, date checks, returned is final', async () => {
      const r = await outOk(expense({ method: 'cheque', cheque: cheque(), amount: 800 }));
      const c = r.payment.cheque!;
      expect(c.allowedStatuses).toEqual(['cleared', 'returned']);
      expect((await setOutCheque(c.id, c.rowVersion, 'cleared', { statusDate: '2026-11-11' })).body.error.code).toBe(
        'error.cheque.date_invalid',
      );
      const ret = (await setOutCheque(c.id, c.rowVersion, 'returned').expect(200)).body as OutResult;
      const res = await setOutCheque(ret.payment.cheque!.id, ret.payment.cheque!.rowVersion, 'cleared');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('error.cheque.invalid_transition');
    });

    it('a status date may not be earlier than the current status date (B5 item 6); refund statement and tie-out hold', async () => {
      const d = await doctor();
      await payIn({ doctorId: d, method: 'cash', amount: 15000, paidAt: '2026-11-01' });
      const r = await outOk(refund(d, 5000, { method: 'cheque', paidAt: '2026-11-02', cheque: cheque() }));
      const c = r.payment.cheque!;
      const cleared = (await setOutCheque(c.id, c.rowVersion, 'cleared', { statusDate: '2026-11-08' }).expect(200))
        .body as OutResult;
      const cc = cleared.payment.cheque!;
      const early = await setOutCheque(cc.id, cc.rowVersion, 'returned', { statusDate: '2026-11-05' }).expect(400);
      expect(early.body.error.code).toBe('error.cheque.date_invalid');
      await setOutCheque(cc.id, cc.rowVersion, 'returned', { statusDate: '2026-11-08' }).expect(200);
      const { st } = await tieOut(d);
      expect(st.lines.map((l) => l.kind)).toEqual(['payment', 'refund', 'refund_cheque_return']);
      expect(st.closing).toBe(-15000);
      // An expense cheque follows the same rule.
      const e = await outOk(expense({ method: 'cheque', cheque: cheque(), amount: 700, paidAt: '2026-11-02' }));
      const ec = (await setOutCheque(e.payment.cheque!.id, e.payment.cheque!.rowVersion, 'cleared', { statusDate: '2026-11-09' }).expect(200))
        .body as OutResult;
      const bad = await setOutCheque(ec.payment.cheque!.id, ec.payment.cheque!.rowVersion, 'returned', { statusDate: '2026-11-03' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('error.cheque.date_invalid');
    });

    it('each endpoint only knows its own direction: an outgoing cheque is 404 on /cheques, and the reverse', async () => {
      const o = await outOk(expense({ method: 'cheque', cheque: cheque(), amount: 801 }));
      expect((await setInCheque(o.payment.cheque!.id, o.payment.cheque!.rowVersion, 'cleared')).status).toBe(404);
      const d = await doctor();
      const i = await payIn({ doctorId: d, method: 'cheque', amount: 100, cheque: { chequeNo: `I-${++seq}`, bank: 'B', dueDate: TODAY } });
      expect((await setOutCheque(i.payment.cheque!.id, i.payment.cheque!.rowVersion, 'cleared')).status).toBe(404);
    });

    it('the duplicate check is per direction', async () => {
      const d = await doctor();
      const same = { chequeNo: `DUP-${++seq}`, bank: 'Shared Bank', dueDate: TODAY };
      await payIn({ doctorId: d, method: 'cheque', amount: 100, cheque: same });
      await outOk(expense({ method: 'cheque', cheque: same, amount: 100 }));
      const dup = await out(expense({ method: 'cheque', cheque: { ...same, bank: 'shared bank' }, amount: 100 }));
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('error.cheque.duplicate');
    });

    it('the register lists both directions by due date with direction chips; the old /cheques stays incoming only', async () => {
      const d = await doctor();
      const tag = `REG-${++seq}`;
      await payIn({ doctorId: d, method: 'cheque', amount: 111, cheque: { chequeNo: `${tag}-in`, bank: 'B', dueDate: '2026-11-12' } });
      await outOk(expense({ method: 'cheque', payee: 'Supplier Z', cheque: { chequeNo: `${tag}-out`, bank: 'B', dueDate: '2026-11-11' }, amount: 222 }));
      const all = (await get(`/cheques/register?search=${tag}`).expect(200)).body as {
        items: { direction: string; cheque: { chequeNo: string }; party: { kind: string; name: string }; payment: { voucherNo: string } }[];
        total: number;
      };
      expect(all.items.map((i) => [i.direction, i.cheque.chequeNo, i.party.kind])).toEqual([
        ['out', `${tag}-out`, 'payee'],
        ['in', `${tag}-in`, 'doctor'],
      ]);
      expect(all.items[0]?.party.name).toBe('Supplier Z');
      expect(all.items[0]?.payment.voucherNo).toMatch(/^OUT-/);
      const onlyOut = (await get(`/cheques/register?search=${tag}&direction=out`).expect(200)).body as { total: number };
      expect(onlyOut.total).toBe(1);
      const sum = (await get(`/cheques/register/summary?search=${tag}`).expect(200)).body;
      expect(sum).toMatchObject({ byDirection: { in: 1, out: 1 }, pendingAmount: { in: 111, out: 222 } });
      // The B3 register endpoint is unchanged: incoming only.
      const old = (await get(`/cheques?search=${tag}`).expect(200)).body as { total: number };
      expect(old.total).toBe(1);
    });

    it('without expenses.read the register shows no outgoing cheque', async () => {
      const auth = await tokenWith('cheques.read');
      const tag = `PERM-${++seq}`;
      await outOk(expense({ method: 'cheque', cheque: { chequeNo: tag, bank: 'B', dueDate: TODAY }, amount: 5 }));
      expect((await as(auth).get(`/cheques/register?search=${tag}`).expect(200)).body.total).toBe(0);
      expect((await as(auth).get(`/cheques/register?search=${tag}&direction=out`).expect(200)).body.total).toBe(0);
      expect((await as(auth).get(`/cheques/register/summary?search=${tag}`).expect(200)).body.byDirection).toEqual({ in: 0, out: 0 });
    });
  });

  describe('lists', () => {
    it('filters by category, kind, method, status, counted, date and search; totals of the filtered set', async () => {
      const payee = `Filter Payee ${++seq}`;
      await outOk(expense({ payee, amount: 100 }));
      await outOk(expense({ payee, amount: 200, method: 'cheque', cheque: cheque() }));
      const page = (await get(`/outgoing-payments?search=${encodeURIComponent(payee)}`).expect(200)).body as {
        total: number;
        totals: { counted: number; pendingCheques: number };
      };
      expect(page.total).toBe(2);
      expect(page.totals).toEqual({ counted: 100, pendingCheques: 200 });
      expect((await get(`/outgoing-payments?search=${encodeURIComponent(payee)}&counted=false`).expect(200)).body.total).toBe(1);
      expect((await get(`/outgoing-payments?search=${encodeURIComponent(payee)}&method=cheque`).expect(200)).body.total).toBe(1);
      expect((await get(`/outgoing-payments?kind=doctor_refund&search=${encodeURIComponent(payee)}`).expect(200)).body.total).toBe(0);
      const one = (await get('/outgoing-payments?search=OUT-000002').expect(200)).body as { items: OutBody[] };
      expect(one.items.map((i) => i.voucherNo)).toContain('OUT-000002');
      expect((await get('/outgoing-payments?bogus=1')).status).toBe(400);
    });
  });

  describe('Home figures', () => {
    it('outgoing figures by effective date; null without expenses.read; incoming figures unchanged', async () => {
      const before = (await get('/ledger/summary').expect(200)).body;
      await outOk(expense({ amount: 1000 }));
      const after = (await get('/ledger/summary').expect(200)).body;
      expect(after.outgoingThisMonth - before.outgoingThisMonth).toBe(1000);
      expect(after.outgoingTotal - before.outgoingTotal).toBe(1000);
      for (const k of ['receivedThisMonth', 'receivedTotal', 'owedToLab', 'pendingChequesCount', 'pendingChequesAmount', 'chequesDueSoon', 'chequesOverdue'])
        expect(after[k]).toBe(before[k]);
      const limited = (await as(await tokenWith('ledger.read')).get('/ledger/summary').expect(200)).body;
      expect(limited).toMatchObject({ outgoingThisMonth: null, outgoingTotal: null, outgoingChequesDueSoon: null, outgoingChequesOverdue: null });
    });
  });

  describe('permissions', () => {
    const routes: [string, string][] = [
      ['post', '/outgoing-payments'],
      ['get', '/outgoing-payments'],
      ['get', '/outgoing-payments/1'],
      ['post', '/outgoing-payments/1/void'],
      ['patch', '/outgoing-cheques/1/status'],
      ['get', '/cheques/register'],
      ['get', '/cheques/register/summary'],
    ];
    it.each(routes)('%s %s: 401 without a token, 403 without the permission', async (method, path) => {
      const r = request(t.http);
      const call = (m: string) =>
        m === 'get' ? r.get(api(path)) : m === 'post' ? r.post(api(path)).send({}) : r.patch(api(path)).send({});
      await call(method).expect(401);
      await call(method).set('Authorization', t.limitedAuth).expect(403);
    });

    it('expenses.write alone cannot read, void, or refund (a refund also needs ledger.read)', async () => {
      const w = as(await tokenWith('expenses.write'));
      const ok = await w.post('/outgoing-payments', expense({ amount: 10 }), randomUUID());
      expect(ok.status).toBe(201);
      await w.get('/outgoing-payments').expect(403);
      await w.post(`/outgoing-payments/${ok.body.payment.id}/void`, { rowVersion: 1, reason: 'x' }).expect(403);
      const d = await doctor();
      const res = await w.post('/outgoing-payments', refund(d, 1), randomUUID());
      expect(res.status).toBe(403);
    });

    it('cheques.write alone cannot change an outgoing cheque (needs expenses.write too)', async () => {
      const r = await outOk(expense({ method: 'cheque', cheque: cheque(), amount: 10 }));
      await as(await tokenWith('cheques.write')).patch(`/outgoing-cheques/${r.payment.cheque!.id}/status`, {
        rowVersion: r.payment.cheque!.rowVersion,
        status: 'cleared',
      }).expect(403);
    });
  });
});
