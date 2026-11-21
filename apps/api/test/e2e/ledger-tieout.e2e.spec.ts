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
    // B5: the demo delivers cases with full, part and no payment (one by a cheque still pending).
    expect(report.deliveries.full).toBeGreaterThanOrEqual(3);
    expect(report.deliveries.partial).toBeGreaterThanOrEqual(3);
    expect(report.deliveries.none).toBeGreaterThanOrEqual(3);
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

  it('B5 item 6: a bounce never sorts above its clearing; an early return date is refused and the tie-out still holds', async () => {
    const order = (lines: { kind: string; voucher: string | null }[]) => {
      for (const [clear, back] of [
        ['payment', 'cheque_return'],
        ['refund', 'refund_cheque_return'],
      ] as const) {
        lines.forEach((l, i) => {
          if (l.kind !== back) return;
          const cleared = lines.findIndex((x) => x.kind === clear && x.voucher === l.voucher);
          expect({ voucher: l.voucher, clearedBeforeReturn: cleared >= 0 && cleared < i }).toEqual({
            voucher: l.voucher,
            clearedBeforeReturn: true,
          });
        });
      }
    };
    const list = (await get('/doctors?pageSize=100').expect(200)).body.items as {
      id: number;
      balance: number;
    }[];
    type Line = { kind: string; voucher: string | null };
    for (const d of list) {
      const st = (await get(`/doctors/${d.id}/statement?pageSize=100`).expect(200)).body as { lines: Line[] };
      order(st.lines);
    }

    // A new cheque on a demo doctor with debt: paid 5 days ago, cleared 2 days ago, returned "3 days ago".
    const settings = (await get('/settings').expect(200)).body as { labProfile: { timeZone: string } };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.labProfile.timeZone }).format(
      new Date(),
    );
    const day = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const target = list.find((d) => d.balance > 50_000)!;
    const send = (method: 'post' | 'patch', p: string, body: object) => {
      const r = method === 'post' ? request(t.http).post(`/api/v1${p}`) : request(t.http).patch(`/api/v1${p}`);
      return r
        .set('Authorization', t.auth)
        .set('Idempotency-Key', crypto.randomUUID())
        .send(body);
    };
    const made = await send('post', '/payments', {
      doctorId: target.id,
      method: 'cheque',
      amount: 10_000,
      paidAt: day(5),
      cheque: { chequeNo: `B5-${Date.now()}`, bank: 'Tie-out Bank', dueDate: day(4) },
    }).expect(201);
    const ch = made.body.payment.cheque as { id: number; rowVersion: number };
    const cleared = await send('patch', `/cheques/${ch.id}/status`, {
      rowVersion: ch.rowVersion,
      status: 'cleared',
      statusDate: day(2),
    }).expect(200);
    const cc = cleared.body.payment.cheque as { id: number; rowVersion: number };
    const early = await send('patch', `/cheques/${cc.id}/status`, {
      rowVersion: cc.rowVersion,
      status: 'returned',
      statusDate: day(3),
    }).expect(400);
    expect(early.body.error.code).toBe('error.cheque.date_invalid');
    await send('patch', `/cheques/${cc.id}/status`, {
      rowVersion: cc.rowVersion,
      status: 'returned',
      statusDate: day(2),
    }).expect(200);

    const bal = (await get(`/doctors/${target.id}/balance`).expect(200)).body as { balance: number };
    expect(bal.balance).toBe(target.balance); // cleared then returned: back where it was
    const b = (await get(`/doctors/${target.id}/debt-breakdown?pageSize=100`).expect(200))
      .body as BreakdownBody;
    expect(
      b.tieOut.openingRemaining + b.tieOut.casesRemaining + b.tieOut.refundsRemaining - b.tieOut.credit,
    ).toBe(bal.balance);
    const st = (await get(`/doctors/${target.id}/statement?pageSize=100`).expect(200)).body as {
      closing: number;
      lines: { kind: string; voucher: string | null }[];
    };
    expect(st.closing).toBe(bal.balance);
    order(st.lines);
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

  /**
   * B6 (plan §3): invoices are ledger-neutral. For EVERY demo doctor the balance, the breakdown equation, the
   * statement closing, the debts row, the case figures and the installation-wide summaries are recorded, then
   * a cases invoice (every eligible case), a statement and a free invoice are issued, recorded again, voided,
   * and recorded a third time: the three fingerprints are identical. The demo already holds invoices of all
   * three types and a voided one, so the tie-out above ran with invoices present.
   */
  it('invoices never move the ledger: issue and void of every type leave every figure of every doctor unchanged', async () => {
    expect(report.invoices?.cases ?? 0).toBeGreaterThanOrEqual(4);
    expect(report.invoices?.statements ?? 0).toBeGreaterThanOrEqual(2);
    expect(report.invoices?.free ?? 0).toBeGreaterThanOrEqual(2);
    expect(report.invoices?.voided ?? 0).toBeGreaterThanOrEqual(1);
    const summary = (await get('/invoices/summary').expect(200)).body as { active: { cases: number; statement: number; free: number } };
    expect(summary.active.cases).toBeGreaterThanOrEqual(4);

    const list = (await get('/doctors?pageSize=100').expect(200)).body.items as { id: number; name: string }[];
    const fingerprint = async () => {
      const perDoctor: Record<string, unknown> = {};
      for (const d of list) {
        const bal = (await get(`/doctors/${d.id}/balance`).expect(200)).body as Record<string, unknown>;
        const b = (await get(`/doctors/${d.id}/debt-breakdown?pageSize=100`).expect(200)).body as BreakdownBody;
        const st = (await get(`/doctors/${d.id}/statement?pageSize=100`).expect(200)).body as { closing: number; total: number };
        const cases = (await get(`/cases?doctorId=${d.id}&pageSize=100`).expect(200)).body.items as {
          id: number;
          total: number;
          paid: number;
          remaining: number;
        }[];
        perDoctor[d.name] = {
          bal,
          tieOut: b.tieOut,
          openCases: b.openCases.items,
          closing: st.closing,
          statementLines: st.total,
          cases: cases.map((c) => [c.id, c.total, c.paid, c.remaining]),
        };
      }
      return {
        perDoctor,
        debts: (await get('/debts?pageSize=100&direction=all').expect(200)).body,
        ledger: (await get('/ledger/summary').expect(200)).body,
        receipts: (await get('/payments/summary').expect(200)).body,
        cashFlow: (await get('/ledger/cash-flow').expect(200)).body,
      };
    };
    const issue = async (body: object) =>
      (
        await request(t.http)
          .post('/api/v1/invoices')
          .set('Authorization', t.auth)
          .set('Idempotency-Key', crypto.randomUUID())
          .send(body)
          .expect(201)
      ).body as { id: number; rowVersion: number; total: number | null; snapshot: { balances?: { previous: number; current: number } } };

    const before = await fingerprint();
    const issued: { id: number; rowVersion: number }[] = [];
    let casesInvoices = 0;
    for (const d of list) {
      const bal = (await get(`/doctors/${d.id}/balance`).expect(200)).body as { balance: number };
      const eligible = (await get(`/invoices/eligible-cases?doctorId=${d.id}&pageSize=100`).expect(200)).body as {
        items: { caseId: number; total: number }[];
      };
      if (eligible.items.length > 0) {
        const expectedTotal = eligible.items.reduce((s, c) => s + c.total, 0);
        const inv = await issue({ type: 'cases', doctorId: d.id, caseIds: eligible.items.map((c) => c.caseId), expectedTotal });
        expect(inv.total).toBe(expectedTotal);
        // I4: current = the ledger balance at issue; previous + total = current.
        expect(inv.snapshot.balances).toEqual(expect.objectContaining({ current: bal.balance, previous: bal.balance - expectedTotal }));
        issued.push(inv);
        casesInvoices += 1;
      }
      issued.push(await issue({ type: 'statement', doctorId: d.id }));
      issued.push(await issue({ type: 'free', doctorId: d.id, reason: 'Tie-out check', amount: 1_234 }));
    }
    expect(casesInvoices).toBeGreaterThan(3);
    const whileIssued = await fingerprint();
    for (const inv of issued) {
      await request(t.http)
        .post(`/api/v1/invoices/${inv.id}/void`)
        .set('Authorization', t.auth)
        .send({ rowVersion: inv.rowVersion, reason: 'tie-out check' })
        .expect(200);
    }
    const afterVoid = await fingerprint();
    expect(whileIssued).toEqual(before);
    expect(afterVoid).toEqual(before);
  });
});
