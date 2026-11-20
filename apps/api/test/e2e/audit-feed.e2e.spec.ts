import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { startTestApp, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

interface Entry {
  at: string;
  action: string;
  entityType: string;
  entityLabel: string | null;
  actor: string | null;
}

/**
 * B5b items 16 and 17: «آخر العمليات» (the latest audit entries, as a sanitized display-safe subset,
 * for who may read the settings/audit view) and the shade usage counts behind «الأكثر استخدامًا».
 * Read-only, no migration. Each test finds its own entries by the unique names it created.
 */
describe('Audit feed and shade usage (e2e)', () => {
  let t: TestApp;
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object, key?: string) => {
    const r = request(t.http).post(api(path)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const get = (path: string, auth = t.auth) => request(t.http).get(api(path)).set('Authorization', auth);
  const recent = async (auth = t.auth) => (await get('/audit/recent', auth).expect(200)).body as { items: Entry[] };

  /** Counts every statement sent by any pg client during `fn`. */
  async function countStatements(fn: () => Promise<unknown>): Promise<number> {
    const proto = Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
    const original = proto.query;
    let n = 0;
    proto.query = function (this: unknown, ...a: unknown[]) {
      n += 1;
      return original.apply(this, a);
    };
    try {
      await fn();
    } finally {
      proto.query = original;
    }
    return n;
  }

  let workType: number;
  const tag = () => randomUUID().slice(0, 6);
  const TEETH = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22];
  const doctor = async (name: string) => (await post('/doctors', { name }).expect(201)).body.id as number;
  const newCase = async (doctorId: number, shades: (string | undefined)[]) =>
    (
      await post('/cases', {
        doctorId,
        patientName: 'Patient Audit',
        receivedDate: '2026-11-01',
        expectedDate: '2026-12-01',
        lines: shades.map((shade, i) => ({
          toothNo: TEETH[i],
          workTypeId: workType,
          unitPrice: 10_000,
          ...(shade === undefined ? {} : { shade }),
        })),
      }).expect(201)
    ).body as { id: number; caseNo: number; rowVersion: number };

  beforeAll(async () => {
    t = await startTestApp();
    workType = (await post('/work-types', { name: 'Audit crown', unitPrice: 10_000 }).expect(201)).body.id as number;
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('GET /audit/recent', () => {
    it('401 without a token; 403 without settings.read; 200 with it', async () => {
      await request(t.http).get(api('/audit/recent')).expect(401);
      await get('/audit/recent', await tokenWith(t, ['account.self'])).expect(403);
      await get('/audit/recent', await tokenWith(t, ['account.self', 'cases.read', 'payments.read'])).expect(403);
      await get('/audit/recent', await tokenWith(t, ['account.self', 'settings.read'])).expect(200);
    });

    it('lists the newest entries first with exactly the display-safe fields', async () => {
      const name = `Dr Audit ${tag()}`;
      const d = await doctor(name);
      const c = await newCase(d, ['A2']);
      const pay = await post('/payments', { doctorId: d, method: 'cash', amount: 5_000, caseId: c.id }, randomUUID()).expect(201);

      const { items } = await recent();
      expect(items.length).toBeLessThanOrEqual(20);
      for (const e of items) expect(Object.keys(e).sort()).toEqual(['action', 'actor', 'at', 'entityLabel', 'entityType']);
      const caseEntry = items.find((e) => e.action === 'case.created' && e.entityLabel === String(c.caseNo));
      const payEntry = items.find((e) => e.action === 'payment.created' && e.entityLabel === pay.body.payment.voucherNo);
      const docEntry = items.find((e) => e.action === 'doctor.created' && e.entityLabel === name);
      expect(caseEntry).toMatchObject({ entityType: 'case', actor: 'owner' });
      expect(payEntry).toMatchObject({ entityType: 'payment', actor: 'owner' });
      expect(docEntry).toMatchObject({ entityType: 'doctor', actor: 'owner' });
      expect(items.indexOf(payEntry!)).toBeLessThan(items.indexOf(caseEntry!));
      expect(items.indexOf(caseEntry!)).toBeLessThan(items.indexOf(docEntry!));
      const times = items.map((e) => new Date(e.at).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('never returns payloads, reasons, bank details, ids, tokens or addresses', async () => {
      const d = await doctor(`Dr Leak ${tag()}`);
      const secretBank = `SecretBank-${tag()}`;
      const secretReason = `SecretReason-${tag()}`;
      const p = await post(
        '/payments',
        { doctorId: d, method: 'cheque', amount: 7_654_321, cheque: { chequeNo: `CHK-${tag()}`, bank: secretBank, dueDate: '2099-01-01' } },
        randomUUID(),
      ).expect(201);
      await request(t.http)
        .post(api(`/payments/${p.body.payment.id}/void`))
        .set('Authorization', t.auth)
        .send({ rowVersion: p.body.payment.rowVersion, reason: secretReason })
        .expect(200);
      const res = await get('/audit/recent').expect(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(secretBank);
      expect(text).not.toContain(secretReason);
      expect(text).not.toContain('7654321');
      expect(text).not.toContain('76543.21');
      expect(text).not.toMatch(/password|token|127\.0\.0\.1|::1|params|ip/i);
      expect(Object.keys(res.body)).toEqual(['items']);
    });

    it('has a fixed size and no input: 20 at most, no query accepted', async () => {
      const d = await doctor(`Dr Many ${tag()}`);
      for (let i = 0; i < 4; i++) await newCase(d, ['A2']);
      for (let i = 0; i < 20; i++) await doctor(`Dr Fill ${i} ${tag()}`);
      expect((await recent()).items).toHaveLength(20);
      await get('/audit/recent?limit=5').expect(400);
      await get('/audit/recent?q=x').expect(400);
    });

    it('costs a fixed number of statements however many entries exist', async () => {
      const before = await countStatements(() => get('/audit/recent').expect(200));
      const d = await doctor(`Dr Stmt ${tag()}`);
      for (let i = 0; i < 5; i++) await newCase(d, ['A2']);
      const after = await countStatements(() => get('/audit/recent').expect(200));
      expect(after).toBe(before);
    });
  });

  describe('GET /cases/shade-usage', () => {
    it('401 without a token; 403 without cases.read; 200 with it', async () => {
      await request(t.http).get(api('/cases/shade-usage')).expect(401);
      await get('/cases/shade-usage', await tokenWith(t, ['account.self'])).expect(403);
      await get('/cases/shade-usage', await tokenWith(t, ['account.self', 'settings.read'])).expect(403);
      await get('/cases/shade-usage', await tokenWith(t, ['account.self', 'cases.read'])).expect(200);
    });

    it('counts lines per shade (most used first), ignores cancelled cases and lines without a shade; counts only', async () => {
      const read = async () =>
        (await get('/cases/shade-usage?limit=24').expect(200)).body as { items: { shade: string; count: number }[] };
      const before = Object.fromEntries((await read()).items.map((i) => [i.shade, i.count]));
      const d = await doctor(`Dr Shade ${tag()}`);
      await newCase(d, ['ZZ1', 'ZZ1', 'ZZ2', undefined]);
      const cancelled = await newCase(d, ['ZZ2', 'ZZ2', 'ZZ2']);
      await post(`/cases/${cancelled.id}/cancel`, { rowVersion: cancelled.rowVersion }).expect(200);

      const res = await read();
      for (const i of res.items) expect(Object.keys(i).sort()).toEqual(['count', 'shade']);
      const now = Object.fromEntries(res.items.map((i) => [i.shade, i.count]));
      expect((now['ZZ1'] ?? 0) - (before['ZZ1'] ?? 0)).toBe(2);
      expect((now['ZZ2'] ?? 0) - (before['ZZ2'] ?? 0)).toBe(1);
      const counts = res.items.map((i) => i.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(JSON.stringify(res)).not.toContain('Patient Audit');
    });

    it('is bounded: 8 by default, at most 24, and one statement for the query', async () => {
      const d = await doctor(`Dr Shade2 ${tag()}`);
      await newCase(d, ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10']);
      expect(((await get('/cases/shade-usage').expect(200)).body.items as unknown[]).length).toBeLessThanOrEqual(8);
      await get('/cases/shade-usage?limit=25').expect(400);
      await get('/cases/shade-usage?limit=0').expect(400);
      const small = await countStatements(() => get('/cases/shade-usage').expect(200));
      await newCase(d, ['Y1', 'Y1', 'Y1']);
      expect(await countStatements(() => get('/cases/shade-usage').expect(200))).toBe(small);
    });
  });
});
