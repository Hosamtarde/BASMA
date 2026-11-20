import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';

jest.setTimeout(300_000);

const NOON = '2026-11-10T10:00:00Z'; // 12:00 in Hebron

/**
 * Owner condition 1(a) of the B4b approval: no incoming query, report, export, search or Home figure
 * ever sees an outgoing payment or an outgoing cheque — and the reverse. Each side is read through every
 * public endpoint before and after money of the OTHER direction is added (with cheques in every state and
 * the same bank + cheque number on both sides); the bytes must not change.
 */
describe('B4b isolation of incoming and outgoing money (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const patch = (p: string, body: object) => request(t.http).patch(api(p)).set('Authorization', t.auth).send(body);
  const read = async (p: string) => {
    const res = await request(t.http)
      .get(api(p))
      .set('Authorization', t.auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect({ path: p, status: res.status }).toEqual({ path: p, status: 200 });
    return (res.body as Buffer).toString('utf8');
  };
  const pick = (json: string, keys: string[]) => {
    const o = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(keys.map((k) => [k, o[k]]));
  };

  let doctorIn: number;
  let doctorRefund: number;
  let rent: number;
  let refundCat: number;
  const SAME = { chequeNo: 'SAME-1', bank: 'Shared Bank' };

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await request(t.http).get(api('/settings')).set('Authorization', t.auth).expect(200);
    await patch('/settings/lab-profile', { rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' }).expect(200);
    const cats = (await request(t.http).get(api('/expense-categories')).set('Authorization', t.auth).expect(200)).body.items as {
      id: number;
      isDoctor: boolean;
    }[];
    rent = cats.find((c) => !c.isDoctor)?.id as number;
    refundCat = cats.find((c) => c.isDoctor)?.id as number;
    const wt = (await post('/work-types', { name: 'Crown', unitPrice: 10000 }).expect(201)).body.id as number;
    doctorIn = (await post('/doctors', { name: 'Dr Incoming' }).expect(201)).body.id as number;
    doctorRefund = (await post('/doctors', { name: 'Dr Refund' }).expect(201)).body.id as number;
    for (const d of [doctorIn, doctorRefund]) {
      await post('/cases', {
        doctorId: d,
        patientName: 'P',
        receivedDate: '2026-11-01',
        expectedDate: '2026-12-31',
        lines: [{ toothNo: 11, workTypeId: wt, unitPrice: 10000 }],
      }).expect(201);
    }
    // Incoming money of every shape for Dr Incoming, including a cheque numbered like the lab's own one.
    await post('/payments', { doctorId: doctorIn, method: 'cash', amount: 3000, paidAt: '2026-11-02' }, randomUUID()).expect(201);
    const c1 = (await post('/payments', { doctorId: doctorIn, method: 'cheque', amount: 4000, paidAt: '2026-11-02', cheque: { ...SAME, dueDate: '2026-11-12' } }, randomUUID()).expect(201)).body.payment;
    await patch(`/cheques/${c1.cheque.id}/status`, { rowVersion: c1.cheque.rowVersion, status: 'cleared', statusDate: '2026-11-04' }).expect(200);
    await post('/payments', { doctorId: doctorIn, method: 'cheque', amount: 500, paidAt: '2026-11-03', cheque: { chequeNo: 'IN-P', bank: 'B', dueDate: '2026-11-08' } }, randomUUID()).expect(201);
    // Dr Refund overpays: the refund below changes only HIS balance.
    await post('/payments', { doctorId: doctorRefund, method: 'cash', amount: 15000, paidAt: '2026-11-02' }, randomUUID()).expect(201);
  });
  afterAll(async () => {
    await t?.close();
  });

  /** Every incoming read the product has (screens, reports, exports, search, Home), for Dr Incoming. */
  const incomingReads = async () => ({
    payments: await read('/payments?pageSize=100'),
    receipts: await read('/payments/summary?from=2026-11-01&to=2026-11-30'),
    // S22 (B5): the B3 incoming-only list and chips are gone; the register's incoming side replaces them.
    registerIn: await read('/cheques/register?direction=in&pageSize=100'),
    registerChipsIn: ((s: { byDirection: { in: number }; pendingAmount: { in: number } }) => ({
      count: s.byDirection.in,
      pending: s.pendingAmount.in,
    }))(JSON.parse(await read('/cheques/register/summary')) as { byDirection: { in: number }; pendingAmount: { in: number } }),
    balance: await read(`/doctors/${doctorIn}/balance`),
    statement: await read(`/doctors/${doctorIn}/statement?pageSize=100`),
    breakdown: await read(`/doctors/${doctorIn}/debt-breakdown?pageSize=100`),
    caseList: await read('/cases?pageSize=100'),
    paymentsCsv: await read('/exports/payments?lang=en'),
    statementCsv: await read(`/exports/doctors/${doctorIn}/statement?lang=en`),
    // The incoming group of the search (the outgoing group is the other side's read).
    searchSame: (JSON.parse(await read(`/search?q=${SAME.chequeNo}`)) as { groups: { payments: unknown } }).groups.payments,
    searchVoucher: (JSON.parse(await read('/search?q=IN-000001')) as { groups: { payments: unknown } }).groups.payments,
    home: pick(await read('/ledger/summary'), [
      'receivedThisMonth',
      'receivedTotal',
      'pendingChequesCount',
      'pendingChequesAmount',
      'chequesDueSoon',
      'chequesOverdue',
    ]),
  });

  /** Every outgoing read (B4b). */
  const outgoingReads = async () => ({
    list: await read('/outgoing-payments?pageSize=100'),
    summary: await read('/outgoing-payments/summary?from=2026-11-01&to=2026-11-30'),
    registerOut: await read('/cheques/register?direction=out&pageSize=100'),
    outgoingCsv: await read('/exports/outgoing-payments?lang=en'),
    byCategoryCsv: await read('/exports/expenses-by-category?lang=en'),
    cashOut: (JSON.parse(await read('/ledger/cash-flow?from=2026-11-01&to=2026-11-30')) as { out: unknown }).out,
    search: (JSON.parse(await read(`/search?q=${SAME.chequeNo}`)) as { groups: { outgoing: unknown } }).groups.outgoing,
    home: pick(await read('/ledger/summary'), ['outgoingThisMonth', 'outgoingTotal', 'outgoingChequesDueSoon', 'outgoingChequesOverdue']),
  });

  it('incoming → outgoing: no incoming read changes when expenses, refunds and outgoing cheques are added', async () => {
    const before = await incomingReads();
    const out = (body: object) => post('/outgoing-payments', body, randomUUID()).expect(201);
    await out({ categoryId: rent, payee: 'Landlord', method: 'cash', amount: 99999, paidAt: '2026-11-02' });
    await out({ categoryId: rent, payee: 'Bank', method: 'transfer', amount: 1234 });
    // The lab's cheque with the SAME bank and number as the doctor's cleared one; cleared too.
    const same = (await out({ categoryId: rent, payee: 'Supplier', method: 'cheque', amount: 7777, paidAt: '2026-11-02', cheque: { ...SAME, dueDate: '2026-11-12' } })).body.payment;
    await patch(`/outgoing-cheques/${same.cheque.id}/status`, { rowVersion: same.cheque.rowVersion, status: 'cleared', statusDate: '2026-11-04' }).expect(200);
    await out({ categoryId: rent, payee: 'Supplier', method: 'cheque', amount: 555, paidAt: '2026-11-03', cheque: { chequeNo: 'OUT-P', bank: 'B', dueDate: '2026-11-08' } });
    const v = (await out({ categoryId: rent, payee: 'X', method: 'cash', amount: 11 })).body.payment;
    await post(`/outgoing-payments/${v.id}/void`, { rowVersion: v.rowVersion, reason: 'x' }).expect(200);
    // A refund to ANOTHER doctor.
    await out({ categoryId: refundCat, doctorId: doctorRefund, method: 'cash', amount: 5000 });

    const after = await incomingReads();
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      expect({ read: key, value: after[key] }).toEqual({ read: key, value: before[key] });
    }
  });

  it('outgoing → incoming: no outgoing read changes when incoming payments and cheques are added', async () => {
    const before = await outgoingReads();
    await post('/payments', { doctorId: doctorIn, method: 'cash', amount: 100 }, randomUUID()).expect(201);
    const c = (await post('/payments', { doctorId: doctorIn, method: 'cheque', amount: 200, paidAt: '2026-11-05', cheque: { chequeNo: 'OUT-P', bank: 'B', dueDate: '2026-11-08' } }, randomUUID()).expect(201)).body.payment;
    await patch(`/cheques/${c.cheque.id}/status`, { rowVersion: c.cheque.rowVersion, status: 'cleared', statusDate: '2026-11-06' }).expect(200);
    await post('/payments', { doctorId: doctorIn, method: 'cheque', amount: 300, cheque: { chequeNo: 'NEW-IN', bank: 'Shared Bank', dueDate: '2026-11-20' } }, randomUUID()).expect(201);
    const after = await outgoingReads();
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      expect({ read: key, value: after[key] }).toEqual({ read: key, value: before[key] });
    }
  });
});
