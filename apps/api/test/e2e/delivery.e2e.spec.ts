import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, statusesOf, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

/** 2026-11-10 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-10T10:00:00Z';
const TODAY = '2026-11-10';

interface CaseBody {
  id: number;
  caseNo: number;
  rowVersion: number;
  status: string;
  total: number;
  paid: number;
  remaining: number;
  pendingCheques: number;
  deliveryDue: number | null;
  deliveredDate: string | null;
  collectOn: string | null;
  allowedStatuses: string[];
  history: { toStatus: string; deliveredDate: string | null; note: string | null }[];
}
interface PaymentBody {
  id: number;
  voucherNo: string;
  amount: number;
  method: string;
  counted: boolean;
  paidAt: string;
  case: { id: number; caseNo: number } | null;
  cheque: { id: number; status: string; rowVersion: number } | null;
}
interface DeliveryBody {
  case: CaseBody;
  payment: PaymentBody | null;
  doctorBalance: number | null;
}

/**
 * B5 delivery (SPEC §5.7, §9; docs/plans/b5-delivery-notifications-backlog.md §4): POST /cases/{id}/delivery
 * and PATCH /cases/{id}/collect-on. Figures are hand-calculated; after every money step the doctor's
 * balance, the breakdown equation and the statement closing must agree (the B4 tie-out).
 */
describe('Delivery and the collect date (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object, key?: string, auth?: string) => {
    const r = request(t.http)
      .post(api(path))
      .set('Authorization', auth ?? t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const patch = (path: string, body: object, auth?: string) =>
    request(t.http)
      .patch(api(path))
      .set('Authorization', auth ?? t.auth)
      .send(body);
  const get = (path: string, auth?: string) =>
    request(t.http)
      .get(api(path))
      .set('Authorization', auth ?? t.auth);

  let workType: number;
  let seq = 0;
  const doctor = async () =>
    (await post('/doctors', { name: `Dr Delivery ${++seq}-${randomUUID().slice(0, 6)}` }).expect(201)).body.id as number;
  const newCase = async (doctorId: number, price: number, receivedDate = '2026-11-01') =>
    (
      await post('/cases', {
        doctorId,
        patientName: 'P',
        receivedDate,
        expectedDate: '2026-11-30',
        status: 'ready',
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      }).expect(201)
    ).body as CaseBody;
  const caseOf = async (id: number) => (await get(`/cases/${id}`).expect(200)).body as CaseBody;
  const deliver = (c: { id: number; rowVersion: number }, body: object, key?: string, auth?: string) =>
    post(`/cases/${c.id}/delivery`, { rowVersion: c.rowVersion, ...body }, key, auth);
  const delivered = async (c: { id: number; rowVersion: number }, body: object, key: string = randomUUID()) =>
    (await deliver(c, body, key).expect(200)).body as DeliveryBody;
  const pay = (body: object) => post('/payments', body, randomUUID());
  const cheque = (extra: object = {}) => ({ chequeNo: `D-${++seq}`, bank: 'Delivery Bank', dueDate: '2026-11-20', ...extra });
  const tieOut = async (doctorId: number) => {
    const bal = (await get(`/doctors/${doctorId}/balance`).expect(200)).body as { balance: number };
    const b = (await get(`/doctors/${doctorId}/debt-breakdown?pageSize=100`).expect(200)).body as {
      tieOut: { openingRemaining: number; casesRemaining: number; refundsRemaining: number; credit: number; balance: number };
    };
    const st = (await get(`/doctors/${doctorId}/statement?pageSize=100`).expect(200)).body as {
      closing: number;
      lines: { kind: string; date: string; debit: number; credit: number }[];
    };
    const eq = b.tieOut.openingRemaining + b.tieOut.casesRemaining + b.tieOut.refundsRemaining - b.tieOut.credit;
    expect({ eq, header: b.tieOut.balance, closing: st.closing }).toEqual({
      eq: bal.balance,
      header: bal.balance,
      closing: bal.balance,
    });
    return { balance: bal.balance, statement: st };
  };
  const counter = async () =>
    (await t.pool.query<{ next_value: string }>(`SELECT next_value FROM counters WHERE name = 'payment_in_no'`)).rows[0]
      ?.next_value;

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', { rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' }).expect(200);
    workType = (await post('/work-types', { name: 'Delivery crown', unitPrice: 10_000 }).expect(201)).body.id as number;
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('authorization', () => {
    it('401 without a token; 403 without cases.write; money needs payments.write too', async () => {
      const c = await newCase(await doctor(), 10_000);
      await request(t.http).post(api(`/cases/${c.id}/delivery`)).send({ rowVersion: c.rowVersion }).expect(401);
      await deliver(c, { received: 'none', collectOn: TODAY }, undefined, await tokenWith(t, ['cases.read'])).expect(403);
      const casesOnly = await tokenWith(t, ['cases.read', 'cases.write']);
      const full = await deliver(c, { received: 'full', method: 'cash' }, randomUUID(), casesOnly).expect(403);
      expect(full.body.error.code).toBe('error.auth.forbidden');
      // Without money, cases.write is enough.
      await deliver(c, { received: 'none', collectOn: TODAY }, undefined, casesOnly).expect(200);
      await patch(`/cases/${c.id}/collect-on`, { rowVersion: c.rowVersion + 1, collectOn: null }, await tokenWith(t, ['cases.read'])).expect(403);
    });
  });

  describe('what is due at delivery (N1)', () => {
    it('GET /cases/{id} gives deliveryDue = remaining − pending cheques bound to the case; null once delivered', async () => {
      const d = await doctor();
      const c = await newCase(d, 40_000);
      expect(await caseOf(c.id)).toMatchObject({ remaining: 40_000, pendingCheques: 0, deliveryDue: 40_000, collectOn: null });
      await pay({ doctorId: d, caseId: c.id, method: 'cash', amount: 5_000 }).expect(201);
      await pay({ doctorId: d, caseId: c.id, method: 'cheque', amount: 15_000, cheque: cheque() }).expect(201);
      expect(await caseOf(c.id)).toMatchObject({ remaining: 35_000, pendingCheques: 15_000, deliveryDue: 20_000 });
      const r = await delivered(await caseOf(c.id), { received: 'full', method: 'cash' });
      expect(r.payment).toMatchObject({ amount: 20_000 });
      expect(r.case).toMatchObject({ deliveryDue: null, remaining: 15_000, pendingCheques: 15_000, collectOn: null });
      // The bound limit is exactly reached: nothing more may be bound to the case.
      const over = await pay({ doctorId: d, caseId: c.id, method: 'cash', amount: 1 }).expect(409);
      expect(over.body.error.code).toBe('error.payment.exceeds_case_total');
      await tieOut(d);
    });
  });

  describe('received in full', () => {
    it('cash: one payment bound to the case for the amount due, paid on the delivery date; balance, statement, tie-out', async () => {
      const d = await doctor();
      const c = await newCase(d, 25_000);
      const before = await counter();
      const key = randomUUID();
      const r = await delivered(c, { received: 'full', method: 'cash', deliveredDate: '2026-11-09', note: 'by driver' }, key);
      expect(r.case).toMatchObject({ status: 'delivered', deliveredDate: '2026-11-09', collectOn: null, paid: 25_000, remaining: 0 });
      expect(r.case.history.at(-1)).toMatchObject({ toStatus: 'delivered', deliveredDate: '2026-11-09', note: 'by driver' });
      expect(r.payment).toMatchObject({
        amount: 25_000,
        method: 'cash',
        counted: true,
        paidAt: '2026-11-09',
        case: { id: c.id, caseNo: c.caseNo },
      });
      expect(r.payment?.voucherNo).toBe(`IN-${String(Number(before)).padStart(6, '0')}`);
      expect(r.doctorBalance).toBe(0);
      const { statement } = await tieOut(d);
      expect(statement.lines.map((l) => `${l.date} ${l.kind}`)).toEqual(['2026-11-01 case', '2026-11-09 payment']);

      const audit = await t.pool.query<{ action: string; params: Record<string, unknown> }>(
        `SELECT action, params FROM audit_log WHERE (entity = 'case' AND entity_id = $1) OR (entity = 'payment' AND entity_id = $2) ORDER BY id`,
        [String(c.id), String(r.payment?.id)],
      );
      expect(audit.rows.map((a) => a.action)).toEqual(['case.created', 'case.delivered', 'payment.created']);
      expect(audit.rows[1]?.params).toEqual({ caseNo: c.caseNo, from: 'ready', deliveredDate: '2026-11-09', received: 'full' });
      expect(audit.rows[2]?.params).toMatchObject({ amount: 25_000, viaDelivery: true, viaAdvance: false });
    });

    it('needs an Idempotency-Key; a replay answers 200 with the original; another body under the key is 422', async () => {
      const d = await doctor();
      const c = await newCase(d, 10_000);
      const none = await deliver(c, { received: 'full', method: 'cash' }).expect(400);
      expect(none.body.error.code).toBe('error.idempotency.required');
      const key = randomUUID();
      const first = await deliver(c, { received: 'full', method: 'cash' }, key).expect(200);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      const again = await deliver(c, { received: 'full', method: 'cash' }, key).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect((again.body as DeliveryBody).payment?.id).toBe((first.body as DeliveryBody).payment?.id);
      const other = await deliver(c, { received: 'full', method: 'transfer' }, key).expect(422);
      expect(other.body.error.code).toBe('error.idempotency.mismatch');
      // The key of a delivery cannot be reused for a plain payment either.
      const reuse = await post('/payments', { doctorId: d, method: 'cash', amount: 1 }, key).expect(422);
      expect(reuse.body.error.code).toBe('error.idempotency.mismatch');
      const { rows } = await t.pool.query('SELECT 1 FROM payments WHERE case_id = $1', [c.id]);
      expect(rows).toHaveLength(1);
    });

    it('parallel deliveries with the same key create one payment and deliver once', async () => {
      const d = await doctor();
      const c = await newCase(d, 10_000);
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => deliver(c, { received: 'full', method: 'cash' }, key)),
      );
      expect(statusesOf(responses).every((s) => s === 200)).toBe(true);
      expect(new Set(responses.map((r) => (r.body as DeliveryBody).payment?.id)).size).toBe(1);
      const { rows } = await t.pool.query('SELECT 1 FROM payments WHERE case_id = $1', [c.id]);
      expect(rows).toHaveLength(1);
      expect((await caseOf(c.id)).history.filter((h) => h.toStatus === 'delivered')).toHaveLength(1);
    });
  });

  describe('received in part', () => {
    it('by cheque: the cheque is pending (not counted), the collect date is kept, the register and statement follow', async () => {
      const d = await doctor();
      const c = await newCase(d, 30_000);
      const r = await delivered(c, {
        received: 'partial',
        amount: 12_000,
        method: 'cheque',
        cheque: cheque({ dueDate: '2026-11-15' }),
        collectOn: '2026-11-25',
      });
      expect(r.case).toMatchObject({ collectOn: '2026-11-25', paid: 0, remaining: 30_000, pendingCheques: 12_000 });
      expect(r.payment).toMatchObject({ amount: 12_000, counted: false, cheque: { status: 'pending' } });
      expect(r.doctorBalance).toBe(30_000);
      const reg = await get(`/cheques/register?doctorId=${d}`).expect(200);
      expect(reg.body.items).toHaveLength(1);
      // Clearing the cheque moves the money; the collect date stays (history).
      const ch = r.payment!.cheque!;
      await patch(`/cheques/${ch.id}/status`, { rowVersion: ch.rowVersion, status: 'cleared' }).expect(200);
      expect(await caseOf(c.id)).toMatchObject({ paid: 12_000, remaining: 18_000, collectOn: '2026-11-25' });
      const { balance } = await tieOut(d);
      expect(balance).toBe(18_000);
    });

    it('validates the amount and the collect date', async () => {
      const c = await newCase(await doctor(), 10_000);
      const base = { received: 'partial', method: 'cash', collectOn: TODAY };
      const over = await deliver(c, { ...base, amount: 10_001 }, randomUUID()).expect(409);
      expect(over.body.error).toMatchObject({ code: 'error.delivery.exceeds_remaining', params: { max: 10_000 } });
      expect((await deliver(c, { ...base, amount: 10_000 }, randomUUID()).expect(400)).body.error.code).toBe(
        'error.delivery.partial_equals_due',
      );
      expect((await deliver(c, { ...base }, randomUUID()).expect(400)).body.error.code).toBe('error.delivery.amount_required');
      expect((await deliver(c, { ...base, amount: 1, collectOn: undefined }, randomUUID()).expect(400)).body.error.code).toBe(
        'error.delivery.collect_on_required',
      );
      expect((await deliver(c, { ...base, amount: 1, collectOn: '2026-11-09' }, randomUUID()).expect(400)).body.error.code).toBe(
        'error.delivery.collect_on_invalid',
      );
      expect((await deliver(c, { ...base, amount: 1, method: undefined }, randomUUID()).expect(400)).body.error.code).toBe(
        'error.delivery.method_required',
      );
      expect((await deliver(c, { ...base, amount: 1, method: 'cheque' }, randomUUID()).expect(400)).body.error.code).toBe(
        'error.payment.cheque_required',
      );
      expect((await deliver(c, { ...base, amount: 0 }, randomUUID()).expect(400)).body.error.code).toBe('error.validation.failed');
      expect((await deliver(c, { ...base, amount: 1.5 }, randomUUID()).expect(400)).body.error.code).toBe('error.validation.failed');
      expect((await deliver(c, { ...base, amount: 1, extra: true }, randomUUID()).expect(400)).body.error.code).toBe(
        'error.validation.failed',
      );
      // Nothing was changed by any refusal.
      expect(await caseOf(c.id)).toMatchObject({ status: 'ready', rowVersion: c.rowVersion });
    });
  });

  describe('nothing received', () => {
    it('needs a collect date on or after the delivery date; no payment, no money moves', async () => {
      const d = await doctor();
      const c = await newCase(d, 8_000);
      expect((await deliver(c, { received: 'none' }).expect(400)).body.error.code).toBe('error.delivery.collect_on_required');
      expect((await deliver(c, {}).expect(400)).body.error.code).toBe('error.delivery.received_required');
      expect((await deliver(c, { received: 'none', collectOn: TODAY, method: 'cash' }).expect(400)).body.error.code).toBe(
        'error.delivery.amount_not_allowed',
      );
      const r = await delivered(c, { received: 'none', collectOn: TODAY });
      expect(r).toMatchObject({ payment: null, doctorBalance: null, case: { collectOn: TODAY, remaining: 8_000 } });
      expect((await tieOut(d)).balance).toBe(8_000);
    });
  });

  describe('nothing due', () => {
    it('a fully paid case is delivered without a question; the money answers are refused', async () => {
      const d = await doctor();
      const c = await newCase(d, 6_000);
      await pay({ doctorId: d, method: 'cash', amount: 6_000 }).expect(201); // unbound: FIFO pays the case
      const fresh = await caseOf(c.id);
      expect(fresh).toMatchObject({ remaining: 0, deliveryDue: 0 });
      const none = await deliver(fresh, { received: 'none', collectOn: TODAY }).expect(409);
      expect(none.body.error.code).toBe('error.delivery.nothing_due');
      expect((await deliver(fresh, { collectOn: TODAY }).expect(400)).body.error.code).toBe('error.delivery.collect_on_not_allowed');
      const r = await delivered(fresh, {});
      expect(r).toMatchObject({ payment: null, case: { status: 'delivered', collectOn: null } });
      const audit = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'case.delivered' AND entity_id = $1`,
        [String(c.id)],
      );
      expect(audit.rows[0]?.params).toMatchObject({ received: 'nothing_due' });
    });
  });

  describe('rollback', () => {
    it('a refusal inside the transaction leaves the case, the money and the voucher counter untouched', async () => {
      const d = await doctor();
      const taken = cheque();
      await pay({ doctorId: d, method: 'cheque', amount: 100, cheque: taken }).expect(201);
      const c = await newCase(d, 10_000);
      const before = await counter();
      const dup = await deliver(c, { received: 'full', method: 'cheque', cheque: taken }, randomUUID()).expect(409);
      expect(dup.body.error.code).toBe('error.cheque.duplicate');
      expect(await caseOf(c.id)).toMatchObject({ status: 'ready', deliveredDate: null, rowVersion: c.rowVersion });
      expect(await counter()).toBe(before);
      const audit = await t.pool.query(`SELECT 1 FROM audit_log WHERE action = 'case.delivered' AND entity_id = $1`, [String(c.id)]);
      expect(audit.rows).toHaveLength(0);
    });
  });

  describe('return and re-delivery', () => {
    it('a return keeps the money, clears the dates; re-delivery asks again with the amount due today', async () => {
      const d = await doctor();
      const c = await newCase(d, 20_000);
      let r = await delivered(c, { received: 'partial', method: 'cash', amount: 5_000, collectOn: '2026-11-20' });
      const back = (await post(`/cases/${c.id}/status`, { rowVersion: r.case.rowVersion, to: 'returned' }).expect(200))
        .body as CaseBody;
      expect(back).toMatchObject({ deliveredDate: null, collectOn: null, paid: 5_000, deliveryDue: 15_000 });
      r = await delivered(back, { received: 'full', method: 'transfer' });
      expect(r.payment).toMatchObject({ amount: 15_000, method: 'transfer' });
      expect(r.case).toMatchObject({ remaining: 0, collectOn: null });
      expect((await tieOut(d)).balance).toBe(0);
    });
  });

  describe('PATCH /cases/{id}/collect-on', () => {
    it('changes or removes the date of a delivered case only; never before the delivery date', async () => {
      const c = await newCase(await doctor(), 9_000);
      const notYet = await patch(`/cases/${c.id}/collect-on`, { rowVersion: c.rowVersion, collectOn: TODAY }).expect(409);
      expect(notYet.body.error.code).toBe('error.case.not_delivered');
      const r = await delivered(c, { received: 'none', collectOn: TODAY, deliveredDate: '2026-11-08' });
      const moved = await patch(`/cases/${c.id}/collect-on`, { rowVersion: r.case.rowVersion, collectOn: '2026-12-01' }).expect(200);
      expect(moved.body.collectOn).toBe('2026-12-01');
      const stale = await patch(`/cases/${c.id}/collect-on`, { rowVersion: r.case.rowVersion, collectOn: TODAY }).expect(409);
      expect(stale.body.error.code).toBe('error.concurrency.stale');
      const early = await patch(`/cases/${c.id}/collect-on`, { rowVersion: moved.body.rowVersion, collectOn: '2026-11-07' }).expect(400);
      expect(early.body.error.code).toBe('error.delivery.collect_on_invalid');
      const cleared = await patch(`/cases/${c.id}/collect-on`, { rowVersion: moved.body.rowVersion, collectOn: null }).expect(200);
      expect(cleared.body.collectOn).toBeNull();
      await patch(`/cases/${c.id}/collect-on`, { rowVersion: cleared.body.rowVersion }).expect(400);
      const audit = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'case.collect_on_changed' AND entity_id = $1 ORDER BY id`,
        [String(c.id)],
      );
      expect(audit.rows.map((a) => a.params)).toEqual([
        { caseNo: c.caseNo, old: TODAY, new: '2026-12-01' },
        { caseNo: c.caseNo, old: '2026-12-01', new: null },
      ]);
    });
  });

  describe('messages in Arabic and English', () => {
    it.each([
      ['ar', 'error.case.delivery_required', 'تسليم الحالة يتم من نافذة «تسليم الحالة» التي تسأل عن المبلغ.'],
      ['en', 'error.case.delivery_required', 'A case is delivered through «Deliver case», which asks about the money.'],
    ])('%s: %s', async (lang, code, message) => {
      const c = await newCase(await doctor(), 1_000);
      const res = await request(t.http)
        .post(api(`/cases/${c.id}/status`))
        .set('Authorization', t.auth)
        .set('Accept-Language', lang)
        .send({ rowVersion: c.rowVersion, to: 'delivered' })
        .expect(409);
      expect(res.body.error).toMatchObject({ code, message });
    });

    it.each(['ar', 'en'])('%s: every delivery code has a message in the catalog', async (lang) => {
      const c = await newCase(await doctor(), 1_000);
      const send = (body: object, key?: string) =>
        request(t.http)
          .post(api(`/cases/${c.id}/delivery`))
          .set('Authorization', t.auth)
          .set('Accept-Language', lang)
          .set(key ? { 'Idempotency-Key': key } : {})
          .send({ rowVersion: c.rowVersion, ...body });
      const answers = [
        await send({}),
        await send({ received: 'none' }),
        await send({ received: 'none', collectOn: '2026-11-01' }),
        await send({ received: 'none', collectOn: TODAY, amount: 1 }),
        await send({ received: 'full' }, randomUUID()),
        await send({ received: 'full', method: 'cash', collectOn: TODAY }, randomUUID()),
        await send({ received: 'partial', method: 'cash', collectOn: TODAY }, randomUUID()),
        await send({ received: 'partial', method: 'cash', amount: 1_000, collectOn: TODAY }, randomUUID()),
        await send({ received: 'partial', method: 'cash', amount: 1_001, collectOn: TODAY }, randomUUID()),
      ];
      for (const a of answers) {
        expect(a.body.error.code).toMatch(/^error\.delivery\./);
        expect(a.body.error.message).not.toBe(a.body.error.code);
        if (lang === 'ar') expect(a.body.error.message).toMatch(/\p{Script=Arabic}/u);
        else expect(a.body.error.message).not.toMatch(/\p{Script=Arabic}/u);
      }
    });
  });

  describe('concurrency', () => {
    it('a delivery with payment and a parallel bound payment never exceed the case total', async () => {
      for (let round = 0; round < 5; round++) {
        const d = await doctor();
        const c = await newCase(d, 10_000);
        const [del, p] = await Promise.all([
          deliver(c, { received: 'full', method: 'cash' }, randomUUID()),
          pay({ doctorId: d, caseId: c.id, method: 'cash', amount: 4_000 }),
        ]);
        const bound = await t.pool.query<{ s: string }>(
          `SELECT coalesce(sum(amount), 0)::text AS s FROM payments WHERE case_id = $1 AND status = 'active'`,
          [c.id],
        );
        expect(Number(bound.rows[0]?.s)).toBeLessThanOrEqual(10_000);
        expect(del.status).toBe(200);
        // Whoever came second saw the first: the delivery takes what is left, or the payment is refused.
        if (p.status === 201) {
          expect((del.body as DeliveryBody).payment?.amount).toBeLessThanOrEqual(10_000);
        } else {
          expect(p.body.error.code).toBe('error.payment.exceeds_case_total');
        }
        expect((await tieOut(d)).balance).toBe(10_000 - Number(bound.rows[0]?.s));
      }
    });

    it('two deliveries of one case: one wins, the other is stale or already delivered', async () => {
      const c = await newCase(await doctor(), 3_000);
      const rs = await Promise.all([
        deliver(c, { received: 'none', collectOn: TODAY }),
        deliver(c, { received: 'full', method: 'cash' }, randomUUID()),
      ]);
      expect(statusesOf(rs).sort()).toEqual([200, 409]);
      const loser = rs.find((r) => r.status === 409)!;
      expect(['error.concurrency.stale', 'error.case.already_delivered']).toContain(loser.body.error.code);
    });

    it('a delivery and a case edit at the same version: one of them is stale', async () => {
      const c = await newCase(await doctor(), 3_000);
      const rs = await Promise.all([
        deliver(c, { received: 'none', collectOn: TODAY }),
        patch(`/cases/${c.id}`, { rowVersion: c.rowVersion, notes: 'edited' }),
      ]);
      expect(statusesOf(rs).sort()).toEqual([200, 409]);
    });
  });
});
