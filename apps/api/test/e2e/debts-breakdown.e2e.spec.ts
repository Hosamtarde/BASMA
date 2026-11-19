import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

const NOON = '2026-11-10T10:00:00Z'; // 12:00 in Hebron
const TODAY = '2026-11-10';

interface Breakdown {
  doctor: { id: number; name: string };
  figures: { balance: number; openingBalance: number; received: number; direction: string };
  openingRemaining: number;
  credit: number;
  tieOut: { openingRemaining: number; casesRemaining: number; credit: number; balance: number };
  openCases: {
    count: number;
    remaining: number;
    total: number;
    page: number;
    pageSize: number;
    items: { caseNo: number; patientName: string; total: number; paid: number; remaining: number; id: number }[];
  };
  latestPayments: {
    voucherNo: string;
    counted: boolean;
    boundCaseNo: number | null;
    amount: number;
    method: string;
  }[];
}

describe('B4 debts breakdown, list figures, statement and receipts summary (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string, auth?: string) =>
    request(t.http)
      .get(api(p))
      .set('Authorization', auth ?? t.auth);
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  let workType: number;
  let seq = 0;

  const doctor = async (opening = 0) =>
    (await post('/doctors', { name: `Dr ${++seq}-${randomUUID().slice(0, 6)}`, openingBalance: opening }).expect(201))
      .body.id as number;
  const kase = async (doctorId: number, price: number, receivedDate = TODAY) =>
    (
      await post('/cases', {
        doctorId,
        patientName: `Patient ${++seq}`,
        receivedDate,
        expectedDate: '2026-12-31',
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      }).expect(201)
    ).body as { id: number; caseNo: number; rowVersion: number };
  const pay = async (body: object) =>
    (await post('/payments', body, randomUUID()).expect(201)).body as {
      payment: { id: number; cheque: { id: number; rowVersion: number } | null };
    };
  const breakdown = async (id: number, q = '') =>
    (await get(`/doctors/${id}/debt-breakdown${q}`).expect(200)).body as Breakdown;
  const balanceOf = async (id: number) => (await get(`/doctors/${id}/balance`).expect(200)).body as { balance: number };
  const rows = (b: Breakdown) => b.openCases.items.map((c) => [c.caseNo, c.remaining]);
  const setCheque = (chequeId: number, rowVersion: number, status: string, extra: object = {}) =>
    request(t.http)
      .patch(api(`/cheques/${chequeId}/status`))
      .set('Authorization', t.auth)
      .send({ rowVersion, status, ...extra });

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await request(t.http)
      .patch(api('/settings/lab-profile'))
      .set('Authorization', t.auth)
      .send({ rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' })
      .expect(200);
    workType = (await post('/work-types', { name: 'Zirconia', unitPrice: 1000 }).expect(201)).body.id as number;
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('permissions', () => {
    it('401 without a token, 403 without ledger.read or without cases.read, 200 with both', async () => {
      const d = await doctor();
      await request(t.http).get(api(`/doctors/${d}/debt-breakdown`)).expect(401);
      await get(`/doctors/${d}/debt-breakdown`, t.limitedAuth).expect(403);
      const res = await get(`/doctors/${d}/debt-breakdown`, await tokenWith(t, ['ledger.read'])).expect(403);
      expect(res.body.error.code).toBe('error.auth.forbidden');
      await get(`/doctors/${d}/debt-breakdown`, await tokenWith(t, ['cases.read'])).expect(403);
      await get(`/doctors/${d}/debt-breakdown`, await tokenWith(t, ['ledger.read', 'cases.read'])).expect(200);
    });

    it('404 for an unknown doctor, 400 for a bad id or paging', async () => {
      await get('/doctors/99999/debt-breakdown').expect(404);
      await get('/doctors/abc/debt-breakdown').expect(400);
      await get('/doctors/1/debt-breakdown?pageSize=0').expect(400);
      await get('/doctors/1/debt-breakdown?bogus=1').expect(400);
    });
  });

  describe('worked examples E1–E5 (amounts in minor units)', () => {
    it('E1: opening, bound and unbound payments, then a cancelled case — 320.00, then 170.00', async () => {
      const d = await doctor(10000);
      const c1 = await kase(d, 30000, '2026-11-01');
      const c2 = await kase(d, 20000, '2026-11-02');
      const c3 = await kase(d, 15000, '2026-11-04');
      await pay({ doctorId: d, method: 'cash', amount: 12000, caseId: c2.id });
      await pay({ doctorId: d, method: 'cash', amount: 25000 });
      await pay({ doctorId: d, method: 'transfer', amount: 6000, caseId: c3.id });
      const b = await breakdown(d);
      expect((await balanceOf(d)).balance).toBe(32000);
      expect(b.figures.balance).toBe(32000);
      expect(rows(b)).toEqual([
        [c1.caseNo, 15000],
        [c2.caseNo, 8000],
        [c3.caseNo, 9000],
      ]);
      expect(b.tieOut).toEqual({ openingRemaining: 0, casesRemaining: 32000, refundsRemaining: 0, credit: 0, balance: 32000 });
      expect(b.latestPayments.map((p) => p.amount)).toEqual([6000, 25000, 12000]);
      expect(b.latestPayments[0]).toMatchObject({ counted: true, boundCaseNo: c3.caseNo, method: 'transfer' });

      await post(`/cases/${c3.id}/cancel`, { rowVersion: c3.rowVersion }).expect(200);
      const after = await breakdown(d);
      expect((await balanceOf(d)).balance).toBe(17000);
      expect(rows(after)).toEqual([
        [c1.caseNo, 9000],
        [c2.caseNo, 8000],
      ]);
      expect(after.tieOut.balance).toBe(17000);
    });

    it('E2: cheque lifecycle — pending, cleared, returned', async () => {
      const d = await doctor();
      const c1 = await kase(d, 40000, '2026-11-01');
      const c2 = await kase(d, 30000, '2026-11-03');
      const ch = (
        await pay({
          doctorId: d,
          method: 'cheque',
          amount: 50000,
          cheque: { chequeNo: `E2-${++seq}`, bank: 'B', dueDate: '2026-11-20' },
        })
      ).payment.cheque!;
      let b = await breakdown(d);
      expect(b.figures.balance).toBe(70000);
      expect(rows(b)).toEqual([
        [c1.caseNo, 40000],
        [c2.caseNo, 30000],
      ]);
      expect(b.latestPayments[0]).toMatchObject({ counted: false, amount: 50000 });

      const cleared = await setCheque(ch.id, ch.rowVersion, 'cleared').expect(200);
      b = await breakdown(d);
      expect(b.figures.balance).toBe(20000);
      expect(rows(b)).toEqual([[c2.caseNo, 20000]]);
      expect(b.latestPayments[0]).toMatchObject({ counted: true });

      await setCheque(ch.id, cleared.body.payment.cheque.rowVersion as number, 'returned').expect(200);
      b = await breakdown(d);
      expect(b.figures.balance).toBe(70000);
      expect(b.openCases.count).toBe(2);
      expect(b.tieOut.casesRemaining).toBe(70000);
    });

    it('E3: overpayment — −50.00, no open case, credit 50.00', async () => {
      const d = await doctor();
      await kase(d, 10000);
      await pay({ doctorId: d, method: 'cash', amount: 15000 });
      const b = await breakdown(d);
      expect(b.openCases.items).toEqual([]);
      expect(b).toMatchObject({ credit: 5000, openingRemaining: 0 });
      expect(b.tieOut).toEqual({ openingRemaining: 0, casesRemaining: 0, refundsRemaining: 0, credit: 5000, balance: -5000 });
      expect(b.figures.direction).toBe('owed_by_lab');
    });

    it('E4: negative opening balance is credit — 20.00 = 70.00 − 50.00', async () => {
      const d = await doctor(-5000);
      const c = await kase(d, 10000);
      await pay({ doctorId: d, method: 'cash', amount: 3000 });
      const b = await breakdown(d);
      expect(rows(b)).toEqual([[c.caseNo, 7000]]);
      expect(b.tieOut).toEqual({ openingRemaining: 0, casesRemaining: 7000, refundsRemaining: 0, credit: 5000, balance: 2000 });
    });

    it('E5: a pending cheque never enters the sum', async () => {
      const d = await doctor();
      const c = await kase(d, 20000);
      await pay({
        doctorId: d,
        method: 'cheque',
        amount: 20000,
        cheque: { chequeNo: `E5-${++seq}`, bank: 'B', dueDate: '2026-11-30' },
      });
      const b = await breakdown(d);
      expect(rows(b)).toEqual([[c.caseNo, 20000]]);
      expect(b.figures.balance).toBe(20000);
      expect(b.tieOut.balance).toBe(20000);
    });

    it('an unpaid positive opening balance is its own line; a settled doctor has nothing open', async () => {
      const d = await doctor(10000);
      const c = await kase(d, 5000);
      await pay({ doctorId: d, method: 'cash', amount: 4000 });
      const b = await breakdown(d);
      expect(b.openingRemaining).toBe(6000);
      expect(rows(b)).toEqual([[c.caseNo, 5000]]);
      expect(b.tieOut.balance).toBe(11000);
      await pay({ doctorId: d, method: 'cash', amount: 11000 });
      const settled = await breakdown(d);
      expect(settled.openCases).toMatchObject({ count: 0, remaining: 0, items: [] });
      expect(settled.tieOut).toEqual({ openingRemaining: 0, casesRemaining: 0, refundsRemaining: 0, credit: 0, balance: 0 });
    });

    it('pages the open cases while the totals always cover all of them', async () => {
      const d = await doctor();
      const cs = [];
      for (let i = 0; i < 5; i++) cs.push(await kase(d, 1000 * (i + 1), `2026-11-0${i + 1}`));
      const p1 = await breakdown(d, '?pageSize=2&page=1');
      const p3 = await breakdown(d, '?pageSize=2&page=3');
      expect(p1.openCases).toMatchObject({ count: 5, remaining: 15000, total: 5, page: 1, pageSize: 2 });
      expect(rows(p1)).toEqual([
        [cs[0]!.caseNo, 1000],
        [cs[1]!.caseNo, 2000],
      ]);
      expect(rows(p3)).toEqual([[cs[4]!.caseNo, 5000]]);
      expect(p3.openCases.remaining).toBe(15000);
      expect(p1.tieOut.casesRemaining).toBe(15000);
    });
  });

  describe('paid / remaining in the cases list and the balance in the doctors list', () => {
    it('list rows equal the case page; a caller without ledger.read gets null', async () => {
      const d = await doctor(2000);
      const c1 = await kase(d, 30000, '2026-11-01');
      const c2 = await kase(d, 20000, '2026-11-02');
      await pay({ doctorId: d, method: 'cash', amount: 25000 });
      await pay({ doctorId: d, method: 'cash', amount: 5000, caseId: c2.id });
      const list = (await get(`/cases?doctorId=${d}&pageSize=100`).expect(200)).body.items as {
        id: number;
        paid: number;
        remaining: number;
      }[];
      expect(list).toHaveLength(2);
      for (const row of list) {
        const detail = (await get(`/cases/${row.id}`).expect(200)).body as { paid: number; remaining: number };
        expect({ paid: row.paid, remaining: row.remaining }).toEqual({
          paid: detail.paid,
          remaining: detail.remaining,
        });
      }
      // The 50.00 bound to c2 pays it first; the 250.00 pool pays the 20.00 opening, then c1 (23000 of 30000).
      expect(list.find((r) => r.id === c1.id)).toMatchObject({ paid: 23000, remaining: 7000 });
      expect(list.find((r) => r.id === c2.id)).toMatchObject({ paid: 5000, remaining: 15000 });

      const plain = (await get(`/cases?doctorId=${d}`, await tokenWith(t, ['cases.read'])).expect(200)).body
        .items as { paid: unknown; remaining: unknown }[];
      for (const row of plain) expect(row).toMatchObject({ paid: null, remaining: null });
    });

    it('a cancelled case shows 0 / 0', async () => {
      const d = await doctor();
      const c = await kase(d, 10000);
      await post(`/cases/${c.id}/cancel`, { rowVersion: c.rowVersion }).expect(200);
      const row = (await get(`/cases?doctorId=${d}`).expect(200)).body.items[0];
      expect(row).toMatchObject({ status: 'cancelled', paid: 0, remaining: 0 });
    });

    it('doctors list carries balance and direction equal to /balance; null without ledger.read', async () => {
      const d = await doctor(500);
      await kase(d, 10000);
      const items = (await get('/doctors?pageSize=100').expect(200)).body.items as {
        id: number;
        balance: number | null;
        direction: string | null;
      }[];
      for (const item of items) {
        const b = (await get(`/doctors/${item.id}/balance`).expect(200)).body as {
          balance: number;
          direction: string;
        };
        expect({ balance: item.balance, direction: item.direction }).toEqual({
          balance: b.balance,
          direction: b.direction,
        });
      }
      expect(items.find((i) => i.id === d)).toMatchObject({ balance: 10500, direction: 'owed_to_lab' });
      const plain = (await get('/doctors', await tokenWith(t, ['doctors.read'])).expect(200)).body.items as {
        balance: unknown;
      }[];
      for (const item of plain) expect(item.balance).toBeNull();
    });
  });

  describe('statement: readable lines, totals and the closing = balance tie-out', () => {
    interface Line {
      kind: string;
      patientName: string | null;
      voucher: string | null;
      method: string | null;
      chequeNo: string | null;
      bank: string | null;
      boundCaseNo: number | null;
      debit: number;
      credit: number;
    }
    it('carries patient, voucher, method, cheque and bound case; closing equals the balance', async () => {
      const d = await doctor(1000);
      const c1 = await kase(d, 20000, '2026-11-01');
      await pay({ doctorId: d, method: 'cash', amount: 5000, caseId: c1.id });
      const chq = (
        await pay({
          doctorId: d,
          method: 'cheque',
          amount: 7000,
          cheque: { chequeNo: 'ST-77', bank: 'Arab Bank', dueDate: '2026-11-20' },
        })
      ).payment.cheque!;
      const cleared = await setCheque(chq.id, chq.rowVersion, 'cleared').expect(200);
      const st = (await get(`/doctors/${d}/statement?pageSize=100`).expect(200)).body as {
        closing: number;
        openingBalance: number;
        totals: { debit: number; credit: number };
        lines: Line[];
      };
      expect(st.closing).toBe((await balanceOf(d)).balance);
      expect(st.totals).toEqual({ debit: 20000, credit: 12000 });
      expect(st.closing).toBe(st.openingBalance + st.totals.debit - st.totals.credit);
      const caseLine = st.lines.find((l) => l.kind === 'case')!;
      expect(caseLine).toMatchObject({ patientName: expect.stringContaining('Patient') as string, voucher: null });
      const cash = st.lines.find((l) => l.method === 'cash')!;
      expect(cash).toMatchObject({ voucher: expect.stringMatching(/^IN-\d{6}$/) as string, boundCaseNo: c1.caseNo, credit: 5000 });
      expect(st.lines.find((l) => l.chequeNo === 'ST-77')).toMatchObject({ bank: 'Arab Bank', method: 'cheque' });

      // Patient names need cases.read.
      const hidden = (await get(`/doctors/${d}/statement`, await tokenWith(t, ['ledger.read'])).expect(200)).body
        .lines as Line[];
      for (const l of hidden) expect(l.patientName).toBeNull();

      await setCheque(chq.id, cleared.body.payment.cheque.rowVersion as number, 'returned').expect(200);
      const after = (await get(`/doctors/${d}/statement?pageSize=100`).expect(200)).body as { closing: number };
      expect(after.closing).toBe((await balanceOf(d)).balance);
    });
  });

  describe('receipts summary', () => {
    it('counts by method on the effective date, shows pending cheques and voids as memo lines', async () => {
      const fresh = await startTestApp({}, { clock: new FakeClock(new Date(NOON)) });
      try {
        const a = (p: string) => request(fresh.http).get(api(p)).set('Authorization', fresh.auth);
        const s = await a('/settings').expect(200);
        await request(fresh.http)
          .patch(api('/settings/lab-profile'))
          .set('Authorization', fresh.auth)
          .send({ rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' })
          .expect(200);
        const doc = (
          await request(fresh.http).post(api('/doctors')).set('Authorization', fresh.auth).send({ name: 'Dr Sum' }).expect(201)
        ).body.id as number;
        const send = (body: object) =>
          request(fresh.http)
            .post(api('/payments'))
            .set('Authorization', fresh.auth)
            .set('Idempotency-Key', randomUUID())
            .send(body)
            .expect(201);
        await send({ doctorId: doc, method: 'cash', amount: 10000, paidAt: '2026-11-03' });
        await send({ doctorId: doc, method: 'transfer', amount: 2500, paidAt: '2026-11-04' });
        const cleared = (
          await send({
            doctorId: doc,
            method: 'cheque',
            amount: 4000,
            paidAt: '2026-10-20',
            cheque: { chequeNo: 'S1', bank: 'B', dueDate: '2026-11-05' },
          })
        ).body.payment.cheque as { id: number; rowVersion: number };
        await request(fresh.http)
          .patch(api(`/cheques/${cleared.id}/status`))
          .set('Authorization', fresh.auth)
          .send({ rowVersion: cleared.rowVersion, status: 'cleared', statusDate: '2026-11-06' })
          .expect(200);
        await send({
          doctorId: doc,
          method: 'cheque',
          amount: 900,
          paidAt: '2026-11-07',
          cheque: { chequeNo: 'S2', bank: 'B', dueDate: '2026-12-05' },
        });
        const voided = (await send({ doctorId: doc, method: 'cash', amount: 700, paidAt: '2026-11-08' })).body
          .payment as { id: number; rowVersion: number };
        await request(fresh.http)
          .post(api(`/payments/${voided.id}/void`))
          .set('Authorization', fresh.auth)
          .send({ rowVersion: voided.rowVersion, reason: 'typo' })
          .expect(200);

        const month = (await a('/payments/summary?from=2026-11-01&to=2026-11-30').expect(200)).body;
        // The cheque was paid in October but cleared on 2026-11-06: it counts in November.
        expect(month.counted).toEqual({
          amount: 16500,
          count: 3,
          byMethod: { cash: 10000, transfer: 2500, cheque: 4000 },
        });
        expect(month.pendingCheques).toEqual({ count: 1, amount: 900 });
        expect(month.voided).toEqual({ count: 1, amount: 700 });
        expect(month.last).toMatchObject({ paidAt: '2026-11-07', amount: 900 });
        expect(month.basis).toBe('effective');
        // Home's «received this month» is the same number.
        const home = (await a('/ledger/summary').expect(200)).body as { receivedThisMonth: number };
        expect(home.receivedThisMonth).toBe(month.counted.amount);
        // October holds nothing counted (the cheque counts on 11-06); filters narrow it.
        expect((await a('/payments/summary?from=2026-10-01&to=2026-10-31').expect(200)).body.counted.amount).toBe(0);
        expect(
          (await a('/payments/summary?method=cash&from=2026-11-01&to=2026-11-30').expect(200)).body.counted.amount,
        ).toBe(10000);
        await a('/payments/summary?bogus=1').expect(400);
        await request(fresh.http).get(api('/payments/summary')).expect(401);
        const noRead = await tokenWith(fresh, ['ledger.read']);
        await request(fresh.http).get(api('/payments/summary')).set('Authorization', noRead).expect(403);
      } finally {
        await fresh.close();
      }
    });
  });
});
