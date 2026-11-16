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
 *   3. GET /doctors/{id}/debt-breakdown, all pages    (allocate: opening + Σ remaining − credit)
 *   4. GET /doctors/{id}/statement closing, all pages (running balance in SQL)
 */
interface BreakdownBody {
  openingRemaining: number;
  credit: number;
  openCases: {
    count: number;
    remaining: number;
    total: number;
    items: { remaining: number; paid: number; total: number }[];
  };
  tieOut: { openingRemaining: number; casesRemaining: number; credit: number; balance: number };
}

describe('B4 tie-out over the demo data (e2e)', () => {
  let t: TestApp;
  const get = (p: string) => request(t.http).get(`/api/v1${p}`).set('Authorization', t.auth);

  beforeAll(async () => {
    t = await startTestApp();
    await t.app.listen(0, '127.0.0.1');
    const { port } = (t.app.getHttpServer() as Server).address() as AddressInfo;
    await seedDemo({ baseUrl: `http://127.0.0.1:${port}`, username: 'owner', password: OWNER_PASSWORD, extras: true });
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
    expect(list.length).toBe(15 + 7); // the base demo plus the B4 extras
    expect(list.some((d) => d.balance < 0)).toBe(true);
    let withBalance = 0;
    let withCredit = 0;
    let withOpen = 0;
    for (const d of list) {
      const bal = (await get(`/doctors/${d.id}/balance`).expect(200)).body as { balance: number };
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
      const eq = first.openingRemaining + sumRemaining - first.credit;
      // Last statement page holds the closing balance.
      const st = (await get(`/doctors/${d.id}/statement?pageSize=100`).expect(200)).body as { closing: number };

      const label = { doctor: d.name };
      expect({ ...label, listBalance: d.balance }).toEqual({ ...label, listBalance: bal.balance });
      expect({ ...label, equation: eq }).toEqual({ ...label, equation: bal.balance });
      expect({ ...label, header: first.tieOut.balance }).toEqual({ ...label, header: bal.balance });
      expect({ ...label, headerCases: first.tieOut.casesRemaining }).toEqual({ ...label, headerCases: sumRemaining });
      expect({ ...label, closing: st.closing }).toEqual({ ...label, closing: bal.balance });
      if (bal.balance !== 0) withBalance += 1;
      if (first.credit > 0) withCredit += 1;
      if (first.openCases.count > 0) withOpen += 1;
    }
    // The demo is not trivial: it has debts, credits and open cases.
    expect(withBalance).toBeGreaterThan(5);
    expect(withCredit).toBeGreaterThan(0);
    expect(withOpen).toBeGreaterThan(5);
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
