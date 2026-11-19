import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedDemo } from '../../scripts/demo/seed';
import { OWNER_PASSWORD, startTestApp, TestApp } from '../support/app';

jest.setTimeout(600_000);

/**
 * B4 acceptance (SPEC §11): the breakdown ties out to the ledger. The fictional demo installation is
 * built through the real HTTP API (every rule applies), then for EVERY doctor four independent
 * computations must agree:
 *   1. GET /doctors/{id}/balance                      (doctorBalance)
 *   2. the balance column of GET /doctors             (SQL balancesCte)
 *   3. GET /doctors/{id}/debt-breakdown, all pages    (allocate: opening + Σ remaining + refunds − credit)
 *   4. GET /doctors/{id}/statement closing, all pages (running balance in SQL)
 * B4b: the demo now holds refunds to doctors (cash, a pending and a cleared refund cheque) and the R3 case —
 * a refund followed by the doctor's own cheque bouncing — so every equation carries paid_out too.
 */
interface BreakdownBody {
  openingRemaining: number;
  credit: number;
  refundsRemaining: number;
  openRefunds: { voucherNo: string; amount: number; covered: number; remaining: number }[];
  openCases: {
    count: number;
    remaining: number;
    total: number;
    items: { remaining: number; paid: number; total: number }[];
  };
  tieOut: { openingRemaining: number; casesRemaining: number; refundsRemaining: number; credit: number; balance: number };
}

describe('B4 tie-out over the demo data (e2e)', () => {
  let t: TestApp;
  const get = (p: string) => request(t.http).get(`/api/v1${p}`).set('Authorization', t.auth);
  let report: Awaited<ReturnType<typeof seedDemo>>;

  beforeAll(async () => {
    t = await startTestApp();
    await t.app.listen(0, '127.0.0.1');
    const { port } = (t.app.getHttpServer() as Server).address() as AddressInfo;
    report = await seedDemo({ baseUrl: `http://127.0.0.1:${port}`, username: 'owner', password: OWNER_PASSWORD, extras: true });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('balance = list column = breakdown equation = statement closing, for every doctor', async () => {
    const list = (await get('/doctors?pageSize=100').expect(200)).body.items as {
      id: number;
      name: string;
      balance: number;
      direction: string;
    }[];
    expect(list.length).toBe(15 + 8); // the base demo plus the B4 extras (7) and the B4b refund doctor (1)
    expect(list.some((d) => d.balance < 0)).toBe(true);
    let withBalance = 0;
    let withCredit = 0;
    let withOpen = 0;
    let withPaidOut = 0;
    let withOpenRefund = 0;
    for (const d of list) {
      const bal = (await get(`/doctors/${d.id}/balance`).expect(200)).body as {
        balance: number;
        charges: number;
        received: number;
        paidOut: number;
      };
      // The balance formula itself (SPEC §7.3): charges − received + paid_out.
      expect({ doctor: d.name, formula: bal.charges - bal.received + bal.paidOut }).toEqual({
        doctor: d.name,
        formula: bal.balance,
      });
      // Page through ALL the open cases.
      let page = 1;
      let sumRemaining = 0;
      let first: BreakdownBody | null = null;
      for (;;) {
        const b = (await get(`/doctors/${d.id}/debt-breakdown?page=${page}&pageSize=10`).expect(200))
          .body as BreakdownBody;
        first ??= b;
        for (const c of b.openCases.items) {
          expect(c.remaining).toBeGreaterThan(0);
          expect(c.paid + c.remaining).toBe(c.total);
          sumRemaining += c.remaining;
        }
        if (page * 10 >= b.openCases.total) break;
        page += 1;
      }
      // The refunds the doctor's money no longer covers are not paged: all of them are in the response.
      const refundsRemaining = first.openRefunds.reduce((s, r) => s + r.remaining, 0);
      for (const r of first.openRefunds) {
        expect(r.remaining).toBeGreaterThan(0);
        expect(r.covered + r.remaining).toBe(r.amount);
      }
      expect(refundsRemaining).toBe(first.refundsRemaining);
      const eq = first.openingRemaining + sumRemaining + refundsRemaining - first.credit;
      // Last statement page holds the closing balance.
      const st = (await get(`/doctors/${d.id}/statement?pageSize=100`).expect(200)).body as { closing: number };

      const label = { doctor: d.name };
      expect({ ...label, listBalance: d.balance }).toEqual({ ...label, listBalance: bal.balance });
      expect({ ...label, equation: eq }).toEqual({ ...label, equation: bal.balance });
      expect({ ...label, header: first.tieOut.balance }).toEqual({ ...label, header: bal.balance });
      expect({ ...label, headerCases: first.tieOut.casesRemaining }).toEqual({ ...label, headerCases: sumRemaining });
      expect({ ...label, headerRefunds: first.tieOut.refundsRemaining }).toEqual({ ...label, headerRefunds: refundsRemaining });
      if (bal.paidOut > 0) withPaidOut += 1;
      if (refundsRemaining > 0) withOpenRefund += 1;
      expect({ ...label, closing: st.closing }).toEqual({ ...label, closing: bal.balance });
      if (bal.balance !== 0) withBalance += 1;
      if (first.credit > 0) withCredit += 1;
      if (first.openCases.count > 0) withOpen += 1;
    }
    // The demo is not trivial: it has debts, credits and open cases.
    expect(withBalance).toBeGreaterThan(5);
    expect(withCredit).toBeGreaterThan(0);
    expect(withOpen).toBeGreaterThan(5);
    // ...and refunds: the overpaying doctor (cash), the cancelled-case doctor (cleared cheque), the R3 doctor.
    expect(report.outgoing.refunds).toBeGreaterThanOrEqual(4);
    expect(withPaidOut).toBeGreaterThanOrEqual(3);
    expect(withOpenRefund).toBeGreaterThanOrEqual(1);
  });

  it('R3 in the demo: a refund followed by the doctor’s own cheque bouncing — 300.00 = case 200.00 + refund 100.00', async () => {
    const list = (await get(`/doctors?pageSize=100&search=${encodeURIComponent('د. رامي الشيك المرتجع')}`).expect(200))
      .body.items as { id: number }[];
    expect(list).toHaveLength(1);
    const id = list[0]!.id;
    const bal = (await get(`/doctors/${id}/balance`).expect(200)).body as { balance: number; paidOut: number; received: number };
    expect(bal).toMatchObject({ balance: 30000, paidOut: 10000, received: 0 });
    const b = (await get(`/doctors/${id}/debt-breakdown`).expect(200)).body as BreakdownBody;
    expect(b.tieOut).toEqual({ openingRemaining: 0, casesRemaining: 20000, refundsRemaining: 10000, credit: 0, balance: 30000 });
    expect(b.openRefunds).toEqual([expect.objectContaining({ amount: 10000, covered: 0, remaining: 10000 })]);
    const st = (await get(`/doctors/${id}/statement?pageSize=100`).expect(200)).body as { closing: number; lines: { kind: string }[] };
    expect(st.closing).toBe(30000);
    expect(st.lines.map((l) => l.kind)).toEqual(['case', 'payment', 'refund', 'cheque_return']);
  });

  it('expenses never change a doctor balance: the debts total equals the doctors alone', async () => {
    const out = (await get('/outgoing-payments/summary').expect(200)).body as { counted: { amount: number }; refunds: number };
    expect(out.counted.amount).toBeGreaterThan(out.refunds); // the demo has real expenses
    const list = (await get('/doctors?pageSize=100').expect(200)).body.items as { id: number; balance: number }[];
    let fromParts = 0;
    for (const d of list) {
      const bal = (await get(`/doctors/${d.id}/balance`).expect(200)).body as {
        charges: number;
        received: number;
        paidOut: number;
      };
      fromParts += bal.charges - bal.received + bal.paidOut;
    }
    expect(fromParts).toBe(list.reduce((s, d) => s + d.balance, 0));
  });

  it('the debts summary equals the sum of the doctor balances', async () => {
    const list = (await get('/doctors?pageSize=100').expect(200)).body.items as { balance: number }[];
    const debts = (await get('/debts?pageSize=100').expect(200)).body as {
      summary: { owedToLab: number; owedByLab: number; net: number; parties: number };
    };
    const owed = list.filter((d) => d.balance > 0).reduce((s, d) => s + d.balance, 0);
    const credit = list.filter((d) => d.balance < 0).reduce((s, d) => s - d.balance, 0);
    expect(debts.summary).toMatchObject({
      owedToLab: owed,
      owedByLab: credit,
      net: owed - credit,
      parties: list.filter((d) => d.balance !== 0).length,
    });
  });
});
