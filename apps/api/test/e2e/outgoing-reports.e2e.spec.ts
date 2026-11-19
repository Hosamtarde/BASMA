import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';

jest.setTimeout(300_000);

const NOON = '2026-11-10T10:00:00Z'; // 12:00 in Hebron
const BOM_BYTES = [0xef, 0xbb, 0xbf];

/** Minimal RFC 4180 reader for the tests (quotes, doubled quotes, CRLF inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * B4b reports through the real HTTP API (docs/plans/b4b-outgoing-expenses.md §4): the expenses report
 * summary by category (effective date), the cash summary, and the CSV exports — the two new ones and the
 * breakdown / statement files with refund rows. A fresh installation, so every figure is exact (R6 data).
 */
describe('B4b expenses report, cash summary and CSV (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const get = (p: string, auth?: string) => request(t.http).get(api(p)).set('Authorization', auth ?? t.auth);
  const patch = (p: string, body: object) => request(t.http).patch(api(p)).set('Authorization', t.auth).send(body);
  const out = async (body: object) =>
    (await post('/outgoing-payments', body, randomUUID()).expect(201)).body as {
      payment: { id: number; voucherNo: string; rowVersion: number; cheque: { id: number; rowVersion: number } | null };
    };
  let ownerId: number;
  const tokenWith = async (...perms: string[]) =>
    `Bearer ${await new JwtService({ secret: t.config.jwt.accessSecret }).signAsync(
      { sub: String(ownerId), perms: ['account.self', ...perms] },
      { algorithm: 'HS256', expiresIn: 600 },
    )}`;

  async function csv(path: string, auth?: string) {
    const res = await request(t.http)
      .get(api(path))
      .set('Authorization', auth ?? t.auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const raw = res.body as Buffer;
    const rows = parseCsv(raw.toString('utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), ''));
    return { raw, rows, header: rows[0] ?? [], data: rows.slice(1), res };
  }

  let cat = { rent: 0, materials: 0, electricity: 0, refund: 0 };
  let refundDoctor: number;
  let bounceDoctor: number;
  let bounceRefund: string;
  let materialsCheque: { id: number; rowVersion: number };

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    ownerId = (await get('/auth/me').expect(200)).body.id as number;
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', { rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' }).expect(200);
    const items = (await get('/expense-categories?pageSize=100').expect(200)).body.items as {
      id: number;
      name: string;
      isDoctor: boolean;
    }[];
    // Seeded in Arabic (the setup language): pick them by position-independent names.
    const byName = (ar: string) => items.find((c) => c.name === ar)?.id as number;
    cat = {
      rent: byName('إيجار'),
      materials: byName('مواد'),
      electricity: byName('كهرباء'),
      refund: items.find((c) => c.isDoctor)?.id as number,
    };
    const workType = (await post('/work-types', { name: 'Crown', unitPrice: 10000 }).expect(201)).body.id as number;
    const doctor = async (name: string) => (await post('/doctors', { name }).expect(201)).body.id as number;
    const kase = (doctorId: number, price: number, receivedDate: string) =>
      post('/cases', {
        doctorId,
        patientName: 'P',
        receivedDate,
        expectedDate: '2026-12-31',
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      }).expect(201);

    // October: an expense that must not appear in November.
    await out({ categoryId: cat.rent, payee: 'Landlord', method: 'cash', amount: 10000, paidAt: '2026-10-20' });
    // November (R6): rent cash 1 500.00, materials cheque 800.00, electricity transfer 220.00 (voided).
    await out({ categoryId: cat.rent, payee: '=HYPERLINK("x")', method: 'cash', amount: 150000, paidAt: '2026-11-01' });
    const materials = await out({
      categoryId: cat.materials,
      payee: 'Supplier',
      method: 'cheque',
      amount: 80000,
      paidAt: '2026-11-02',
      cheque: { chequeNo: 'L-1', bank: 'Lab Bank', dueDate: '2026-11-05' },
    });
    materialsCheque = materials.payment.cheque!;
    const elec = await out({ categoryId: cat.electricity, payee: 'Power Co', method: 'transfer', amount: 22000, paidAt: '2026-11-03' });
    await post(`/outgoing-payments/${elec.payment.id}/void`, { rowVersion: elec.payment.rowVersion, reason: 'double entry' }).expect(200);

    // A refund of an overpayment: case 100.00, cash 150.00 on 11-02, refund 50.00 on 11-04.
    refundDoctor = await doctor('Dr Refund');
    await kase(refundDoctor, 10000, '2026-11-01');
    await post('/payments', { doctorId: refundDoctor, method: 'cash', amount: 15000, paidAt: '2026-11-02' }, randomUUID()).expect(201);
    await out({ categoryId: cat.refund, doctorId: refundDoctor, method: 'cash', amount: 5000, paidAt: '2026-11-04' });

    // R3: a refund, then the doctor's cheque bounces (the refund line stays open in the breakdown).
    bounceDoctor = await doctor('Dr Bounce');
    await kase(bounceDoctor, 20000, '2026-11-01');
    const chq = (
      await post(
        '/payments',
        { doctorId: bounceDoctor, method: 'cheque', amount: 30000, paidAt: '2026-11-02', cheque: { chequeNo: 'D-1', bank: 'Doc Bank', dueDate: '2026-11-03' } },
        randomUUID(),
      ).expect(201)
    ).body.payment as { cheque: { id: number; rowVersion: number } };
    const cleared = (await patch(`/cheques/${chq.cheque.id}/status`, { rowVersion: chq.cheque.rowVersion, status: 'cleared', statusDate: '2026-11-03' }).expect(200))
      .body.payment as { cheque: { id: number; rowVersion: number } };
    bounceRefund = (await out({ categoryId: cat.refund, doctorId: bounceDoctor, method: 'cash', amount: 10000, paidAt: '2026-11-05' })).payment.voucherNo;
    await patch(`/cheques/${cleared.cheque.id}/status`, { rowVersion: cleared.cheque.rowVersion, status: 'returned', statusDate: '2026-11-08' }).expect(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  const NOV = 'from=2026-11-01&to=2026-11-30';

  describe('expenses report summary (effective date)', () => {
    it('before the materials cheque clears: it is a pending memo line, not counted', async () => {
      const s = (await get(`/outgoing-payments/summary?${NOV}`).expect(200)).body;
      expect(s).toMatchObject({
        counted: { amount: 150000 + 5000 + 10000, count: 3, byMethod: { cash: 165000, transfer: 0, cheque: 0 } },
        refunds: 15000,
        pendingCheques: { count: 1, amount: 80000 },
        voided: { count: 1, amount: 22000 },
        basis: 'effective',
      });
      expect(s.last).toMatchObject({ paidAt: '2026-11-05' });
    });

    it('once cleared on 11-05, the cheque counts on that day; per category totals; October stays out', async () => {
      await patch(`/outgoing-cheques/${materialsCheque.id}/status`, {
        rowVersion: materialsCheque.rowVersion,
        status: 'cleared',
        statusDate: '2026-11-05',
      }).expect(200);
      const s = (await get(`/outgoing-payments/summary?${NOV}`).expect(200)).body;
      expect(s.counted).toEqual({ amount: 245000, count: 4, byMethod: { cash: 165000, transfer: 0, cheque: 80000 } });
      expect(s.pendingCheques).toEqual({ count: 0, amount: 0 });
      const byCat = Object.fromEntries(
        (s.byCategory as { categoryId: number; amount: number; count: number; kind: string }[]).map((c) => [c.categoryId, [c.amount, c.count, c.kind]]),
      );
      expect(byCat).toEqual({
        [cat.rent]: [150000, 1, 'expense'],
        [cat.materials]: [80000, 1, 'expense'],
        [cat.refund]: [15000, 2, 'doctor_refund'],
      });
      // Clearing date outside the range moves it out: the summary of 11-01..11-04 does not count it.
      const early = (await get('/outgoing-payments/summary?from=2026-11-01&to=2026-11-04').expect(200)).body;
      expect(early.counted.byMethod.cheque).toBe(0);
      // October alone.
      const oct = (await get('/outgoing-payments/summary?from=2026-10-01&to=2026-10-31').expect(200)).body;
      expect(oct.counted).toMatchObject({ amount: 10000, count: 1 });
    });

    it("the month equals Home's «outgoing this month»", async () => {
      const home = (await get('/ledger/summary').expect(200)).body;
      const month = (await get('/outgoing-payments/summary?from=2026-11-01&to=2026-11-10').expect(200)).body;
      expect(home.outgoingThisMonth).toBe(month.counted.amount);
      expect(home.outgoingTotal).toBe(month.counted.amount + 10000);
    });

    it('filters by category and kind', async () => {
      const rent = (await get(`/outgoing-payments/summary?${NOV}&categoryId=${cat.rent}`).expect(200)).body;
      expect(rent.counted.amount).toBe(150000);
      const refunds = (await get(`/outgoing-payments/summary?${NOV}&kind=doctor_refund`).expect(200)).body;
      expect(refunds).toMatchObject({ counted: { amount: 15000 }, refunds: 15000 });
    });
  });

  describe('cash summary (SPEC §10)', () => {
    it('in − out by effective date for a period, split by method and kind', async () => {
      const c = (await get(`/ledger/cash-flow?${NOV}`).expect(200)).body;
      // In: the cash 150.00 (refund doctor); the bounce doctor's cheque cleared then returned → not counted.
      expect(c).toEqual({
        from: '2026-11-01',
        to: '2026-11-30',
        in: { total: 15000, cash: 15000, transfer: 0, cheque: 0 },
        out: { total: 245000, cash: 165000, transfer: 0, cheque: 80000, expenses: 230000, refunds: 15000 },
        net: 15000 - 245000,
      });
      // Default: the current lab month up to today.
      const d = (await get('/ledger/cash-flow').expect(200)).body;
      expect(d).toMatchObject({ from: '2026-11-01', to: '2026-11-10', net: c.net });
    });

    it('rejects a reversed range; needs ledger.read AND expenses.read', async () => {
      const bad = await get('/ledger/cash-flow?from=2026-11-10&to=2026-11-01');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('error.ledger.range_invalid');
      await get('/ledger/cash-flow', await tokenWith('ledger.read')).expect(403);
      await get('/ledger/cash-flow', await tokenWith('expenses.read')).expect(403);
      await get('/ledger/cash-flow', await tokenWith('ledger.read', 'expenses.read')).expect(200);
    });
  });

  describe('CSV exports', () => {
    it('outgoing payments: BOM, Arabic headers, every row of the list, injection neutralised, audited', async () => {
      const list = (await get('/outgoing-payments?pageSize=100').expect(200)).body as { total: number };
      const file = await csv('/exports/outgoing-payments?lang=ar');
      expect([...file.raw.subarray(0, 3)]).toEqual(BOM_BYTES);
      expect(file.res.headers['content-disposition']).toMatch(/^attachment; filename="basma-outgoing-payments-2026-11-10\.csv"$/);
      expect(file.header[0]).toBe('رقم السند');
      expect(file.header).toContain('الفئة');
      expect(file.header).toContain('الجهة المستفيدة');
      expect(file.data).toHaveLength(list.total);
      const rent = file.data.find((r) => r.includes('150000.00') || r.includes('1500.00'));
      expect(rent).toBeDefined();
      expect(rent).toContain("'=HYPERLINK(\"x\")");
      expect(file.data.some((r) => r[0]?.startsWith('OUT-'))).toBe(true);
      expect(file.data.some((r) => r.includes('Dr Refund'))).toBe(true); // the payee column names the doctor of a refund
      const audit = await t.pool.query<{ params: Record<string, unknown>; user_id: string }>(
        `SELECT params, user_id::text FROM audit_log WHERE action = 'export.created' ORDER BY id DESC LIMIT 1`,
      );
      expect(audit.rows[0]).toMatchObject({ user_id: String(ownerId), params: { report: 'outgoing_payments', rows: list.total } });
    });

    it('expenses by category (English): one row per category with activity, counted by effective date', async () => {
      const file = await csv(`/exports/expenses-by-category?${NOV}&lang=en`);
      expect(file.header).toEqual([
        'Category',
        'Kind',
        'Payments',
        'Counted amount (ILS)',
        'Cheques not cleared',
        'Cheques not cleared, amount (ILS)',
      ]);
      const rows = Object.fromEntries(file.data.map((r) => [r[1] === 'Refund to doctor' ? 'refund' : r[0], r.slice(2)]));
      expect(rows.refund).toEqual(['2', '150.00', '0', '0.00']);
      expect(file.data).toHaveLength(3);
      const sum = file.data.reduce((s, r) => s + Math.round(Number(r[3]) * 100), 0);
      expect(sum).toBe(245000);
    });

    it('debt breakdown CSV: the refund the doctor owes back is a row, and Remaining still sums to the balance', async () => {
      const bal = (await get(`/doctors/${bounceDoctor}/balance`).expect(200)).body as { balance: number };
      expect(bal.balance).toBe(30000);
      const file = await csv(`/exports/doctors/${bounceDoctor}/debt-breakdown?lang=en`);
      expect(file.header.at(-1)).toBe('Voucher');
      const refundRow = file.data.find((r) => r[0] === 'Refund to doctor');
      expect(refundRow).toEqual(['Refund to doctor', '', '', '2026-11-05', '', '100.00', '0.00', '100.00', bounceRefund]);
      const remaining = file.data.reduce((s, r) => s + Math.round(Number(r[7]) * 100), 0);
      expect(remaining).toBe(bal.balance);
    });

    it('statement CSV: the refund is a debit with its OUT- reference', async () => {
      const file = await csv(`/exports/doctors/${refundDoctor}/statement?lang=en`);
      const row = file.data.find((r) => r[1] === 'Refund to doctor');
      expect(row?.[2]).toMatch(/^OUT-\d{6}$/);
      expect(row?.[4]).toBe('50.00');
      expect(file.data.at(-1)?.[6]).toBe('0.00'); // closing balance after the full refund
    });

    it('needs expenses.read AND exports.run', async () => {
      await request(t.http).get(api('/exports/outgoing-payments')).set('Authorization', await tokenWith('expenses.read')).expect(403);
      await request(t.http).get(api('/exports/expenses-by-category')).set('Authorization', await tokenWith('exports.run')).expect(403);
      await request(t.http).get(api('/exports/outgoing-payments')).expect(401);
    });
  });
});
