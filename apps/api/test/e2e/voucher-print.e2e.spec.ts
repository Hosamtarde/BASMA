import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';

jest.setTimeout(300_000);

/** 2026-11-20 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-20T10:00:00Z';

interface Voucher {
  id: number;
  voucherNo: string;
  amount: number;
  status: string;
  rowVersion: number;
}

/**
 * B6b: a voucher is printed from data the browser already reads. Printing one must not change a ledger figure,
 * a balance, a counter, a number or any row: every GET a voucher page makes (the payment, the outgoing payment,
 * the lab profile and logo, the appearance) is repeated and the whole database is compared before and after.
 * It also pins what a voucher prints: the stored integer amount, a voided payment's mark data, and cheque data.
 */
describe('Printing a payment or expense voucher changes nothing (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string) => request(t.http).get(api(p)).set('Authorization', t.auth);
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };

  const payments: Voucher[] = [];
  const outgoing: Voucher[] = [];
  let doctorId: number;

  /** A digest of every row of every table (rows as text, sorted): any write anywhere changes it. */
  const databaseDigest = async (): Promise<Record<string, string>> => {
    const tables = (
      await t.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      )
    ).rows.map((r) => r.table_name);
    const out: Record<string, string> = {};
    for (const name of tables) {
      const r = await t.pool.query<{ n: string; h: string | null }>(
        `SELECT count(*)::text AS n, md5(coalesce(string_agg(x::text, ',' ORDER BY x::text), '')) AS h FROM "${name}" x`,
      );
      out[name] = `${r.rows[0]!.n}:${r.rows[0]!.h}`;
    }
    return out;
  };

  /** Every read that makes up a ledger figure or a counter shown anywhere. */
  const figures = async () => {
    const read = async (p: string) => (await get(p).expect(200)).body as unknown;
    return {
      balance: await read(`/doctors/${doctorId}/balance`),
      breakdown: await read(`/doctors/${doctorId}/debt-breakdown?pageSize=100`),
      statement: await read(`/doctors/${doctorId}/statement?pageSize=100`),
      debts: await read('/debts'),
      summary: await read('/ledger/summary'),
      cashFlow: await read('/ledger/cash-flow?from=2026-11-01&to=2026-11-30'),
      receipts: await read('/payments/summary'),
      payments: await read('/payments?pageSize=100'),
      outgoing: await read('/outgoing-payments?pageSize=100'),
      settings: await read('/settings'),
    };
  };

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = (await get('/settings').expect(200)).body as { labProfile: { rowVersion: number } };
    await request(t.http)
      .patch(api('/settings/lab-profile'))
      .set('Authorization', t.auth)
      .send({ rowVersion: s.labProfile.rowVersion, timeZone: 'Asia/Hebron', nameEn: 'Voucher Lab' })
      .expect(200);
    const wt = (await post('/work-types', { name: 'Crown', unitPrice: 30_000 }).expect(201)).body.id as number;
    doctorId = (await post('/doctors', { name: 'Dr Voucher' }).expect(201)).body.id as number;
    const c = (
      await post('/cases', {
        doctorId,
        patientName: 'P',
        receivedDate: '2026-11-02',
        expectedDate: '2026-11-25',
        lines: [{ toothNo: 11, workTypeId: wt, unitPrice: 30_000 }],
      }).expect(201)
    ).body as { id: number };

    const pay = async (body: object) => ((await post('/payments', body, randomUUID()).expect(201)).body as { payment: Voucher }).payment;
    payments.push(await pay({ doctorId, caseId: c.id, method: 'cash', amount: 1, paidAt: '2026-11-10', notes: 'cash' }));
    payments.push(await pay({ doctorId, method: 'transfer', amount: 100_050, paidAt: '2026-11-11' }));
    payments.push(
      await pay({
        doctorId,
        method: 'cheque',
        amount: 5_000_000,
        paidAt: '2026-11-12',
        cheque: { chequeNo: 'C-1', bank: 'Arab Bank', dueDate: '2026-12-01' },
      }),
    );
    const voidMe = await pay({ doctorId, method: 'cash', amount: 777, paidAt: '2026-11-13' });
    const voided = (await post(`/payments/${voidMe.id}/void`, { rowVersion: voidMe.rowVersion, reason: "wrong amount" }).expect(200)).body as {
      payment: Voucher;
    };
    payments.push(voided.payment);

    const cats = (await get('/expense-categories?pageSize=100').expect(200)).body.items as { id: number; isDoctor: boolean }[];
    const rent = cats.find((x) => !x.isDoctor)!.id;
    const out = async (body: object) =>
      ((await post('/outgoing-payments', body, randomUUID()).expect(201)).body as { payment: Voucher }).payment;
    outgoing.push(await out({ categoryId: rent, payee: 'Landlord', method: 'cash', amount: 150_000, paidAt: '2026-11-14' }));
    outgoing.push(
      await out({
        categoryId: rent,
        payee: 'Landlord',
        method: 'cheque',
        amount: 100_000_000,
        paidAt: '2026-11-15',
        cheque: { chequeNo: 'O-1', bank: 'Lab Bank', dueDate: '2026-12-15' },
      }),
    );
  });

  afterAll(async () => {
    await t.close();
  });

  it('every voucher read repeated three times leaves every table, balance and counter exactly as it was', async () => {
    const beforeDb = await databaseDigest();
    const beforeFigures = await figures();

    for (let round = 0; round < 3; round += 1) {
      for (const p of payments) await get(`/payments/${p.id}`).expect(200);
      for (const p of outgoing) await get(`/outgoing-payments/${p.id}`).expect(200);
      await get('/settings').expect(200);
      await get('/settings/invoice-template').expect(200);
    }

    expect(await databaseDigest()).toEqual(beforeDb);
    expect(await figures()).toEqual(beforeFigures);
  });

  it('what a voucher prints is the stored data: integer amount, number, method, cheque, void mark', async () => {
    const one = (await get(`/payments/${payments[0]!.id}`).expect(200)).body as Voucher & { case: { caseNo: number } | null };
    expect(one.amount).toBe(1);
    expect(Number.isInteger(one.amount)).toBe(true);
    expect(one.voucherNo).toMatch(/^IN-\d{6}$/u);
    expect(one.case?.caseNo).toBeGreaterThan(0);

    const cheque = (await get(`/payments/${payments[2]!.id}`).expect(200)).body as { cheque: { chequeNo: string; bank: string; dueDate: string; status: string } };
    expect(cheque.cheque).toMatchObject({ chequeNo: 'C-1', bank: 'Arab Bank', dueDate: '2026-12-01', status: 'pending' });

    const voided = (await get(`/payments/${payments[3]!.id}`).expect(200)).body as { status: string; voidReason: string; voidedAt: string };
    expect(voided).toMatchObject({ status: 'void', voidReason: 'wrong amount' });
    expect(new Date(voided.voidedAt).toString()).not.toBe('Invalid Date');

    const out = (await get(`/outgoing-payments/${outgoing[1]!.id}`).expect(200)).body as Voucher & { payee: string; cheque: { chequeNo: string } };
    expect(out.voucherNo).toMatch(/^OUT-\d{6}$/u);
    expect(out.amount).toBe(100_000_000);
    expect(out.payee).toBe('Landlord');
    expect(out.cheque.chequeNo).toBe('O-1');
  });

  it('a voided voucher keeps its number and is never reused by the next payment', async () => {
    const voided = payments[3]!;
    const next = (
      (await post('/payments', { doctorId, method: 'cash', amount: 5, paidAt: '2026-11-16' }, randomUUID()).expect(201)).body as { payment: Voucher }
    ).payment;
    expect(next.voucherNo).not.toBe(voided.voucherNo);
    const again = (await get(`/payments/${voided.id}`).expect(200)).body as Voucher;
    expect(again.voucherNo).toBe(voided.voucherNo);
  });

  it('reading a voucher needs its own permission: a token without payments.read or expenses.read is refused', async () => {
    await request(t.http).get(api(`/payments/${payments[0]!.id}`)).set('Authorization', t.limitedAuth).expect(403);
    await request(t.http).get(api(`/outgoing-payments/${outgoing[0]!.id}`)).set('Authorization', t.limitedAuth).expect(403);
    await request(t.http).get(api(`/payments/${payments[0]!.id}`)).expect(401);
  });
});
