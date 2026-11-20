import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { startTestApp, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

interface Entry {
  id: number;
  at: string;
  action: string;
  text: string;
}

/** Strips the bidi isolates the Arabic texts carry around numbers and dates. */
const plain = (s: string) => s.replace(/[⁦⁧⁨⁩]/g, '');

/**
 * B5b items 16 and 17: «آخر العمليات» (the latest audit entries, rendered per language, shown only for
 * what the caller may read) and the shade usage counts behind «الأكثر استخدامًا». Read-only; no
 * migration. Each test finds its own entries by the unique names it created.
 */
describe('Audit feed and shade usage (e2e)', () => {
  let t: TestApp;
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object, key?: string) => {
    const r = request(t.http).post(api(path)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const get = (path: string, auth = t.auth, lang = 'ar') =>
    request(t.http).get(api(path)).set('Authorization', auth).set('Accept-Language', lang);
  const recent = async (auth = t.auth, lang = 'ar', limit?: number) =>
    (await get(`/audit/recent${limit ? `?limit=${limit}` : ''}`, auth, lang).expect(200)).body as { items: Entry[] };

  let workType: number;
  const tag = () => randomUUID().slice(0, 6);
  const doctor = async (name: string) => (await post('/doctors', { name }).expect(201)).body.id as number;
  const newCase = async (doctorId: number, shades: (string | undefined)[]) =>
    (
      await post('/cases', {
        doctorId,
        patientName: 'Patient Audit',
        receivedDate: '2026-11-01',
        expectedDate: '2026-12-01',
        lines: shades.map((shade, i) => ({
          toothNo: [11, 12, 13, 14, 15, 16, 17, 18, 21, 22][i],
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
    it('401 without a token', async () => {
      await request(t.http).get(api('/audit/recent')).expect(401);
    });

    it('lists the newest entries first, in the caller’s language, with no raw codes', async () => {
      const name = `Dr Audit ${tag()}`;
      const d = await doctor(name);
      const c = await newCase(d, ['A2']);
      await post(
        '/payments',
        { doctorId: d, method: 'cash', amount: 5_000, caseId: c.id },
        randomUUID(),
      ).expect(201);

      const ar = (await recent(t.auth, 'ar')).items;
      const created = ar.find((e) => e.action === 'case.created' && plain(e.text).includes(name));
      expect(created, 'the case entry').toBeDefined();
      expect(plain(created!.text)).toContain(`رقم ${c.caseNo}`);
      const paid = ar.find((e) => e.action === 'payment.created' && plain(e.text).includes(name));
      expect(paid, 'the payment entry').toBeDefined();
      // The method is a label, not the code.
      expect(paid!.text).toContain('نقداً');
      expect(paid!.text).not.toContain('cash');
      // Newest first.
      expect(ar.indexOf(paid!)).toBeLessThan(ar.indexOf(created!));
      expect(new Date(ar[0]!.at).getTime()).toBeGreaterThanOrEqual(new Date(ar[ar.length - 1]!.at).getTime());

      const en = (await recent(t.auth, 'en')).items;
      const enCreated = en.find((e) => e.id === created!.id);
      expect(enCreated!.text).toContain(`Case no. ${c.caseNo}`);
      expect(enCreated!.text).not.toMatch(/[؀-ۿ]/);
      expect(en.find((e) => e.id === paid!.id)!.text).toContain('Cash');
    });

    it('shows status names, not codes, for a status change', async () => {
      const d = await doctor(`Dr Status ${tag()}`);
      const c = await newCase(d, ['A2']);
      await post(`/cases/${c.id}/status`, { rowVersion: c.rowVersion, to: 'in_progress' }).expect(200);
      const e = (await recent()).items.find((x) => x.action === 'case.status_changed' && plain(x.text).includes(`رقم ${c.caseNo}`));
      expect(e).toBeDefined();
      expect(e!.text).toContain('قيد التنفيذ');
      expect(e!.text).not.toContain('in_progress');
    });

    it('returns at most 20 by default; `limit` may lower it up to 50', async () => {
      const d = await doctor(`Dr Many ${tag()}`);
      for (let i = 0; i < 6; i++) await newCase(d, ['A2']);
      expect((await recent()).items.length).toBeLessThanOrEqual(20);
      expect((await recent(t.auth, 'ar', 3)).items).toHaveLength(3);
      await get('/audit/recent?limit=51').expect(400);
      await get('/audit/recent?limit=0').expect(400);
    });

    it('shows only what the caller may read', async () => {
      const name = `Dr Scope ${tag()}`;
      const d = await doctor(name);
      const c = await newCase(d, ['A2']);
      await post('/payments', { doctorId: d, method: 'cash', amount: 1_000, caseId: c.id }, randomUUID()).expect(201);
      const actionsFor = async (perms: string[]) =>
        new Set((await recent(await tokenWith(t, perms))).items.map((e) => e.action));
      expect((await actionsFor(['account.self'])).size).toBe(0);
      const casesOnly = await actionsFor(['account.self', 'cases.read']);
      expect(casesOnly.has('case.created')).toBe(true);
      expect([...casesOnly].some((a) => a.startsWith('payment.') || a.startsWith('doctor.'))).toBe(false);
      const paymentsOnly = await actionsFor(['account.self', 'payments.read']);
      expect(paymentsOnly.has('payment.created')).toBe(true);
      expect([...paymentsOnly].some((a) => a.startsWith('case.'))).toBe(false);
    });
  });

  describe('GET /cases/shade-usage', () => {
    it('401 without a token; 403 without cases.read', async () => {
      await request(t.http).get(api('/cases/shade-usage')).expect(401);
      await get('/cases/shade-usage', await tokenWith(t, ['account.self'])).expect(403);
    });

    it('counts lines per shade (most used first), ignores cancelled cases and lines without a shade', async () => {
      const before = Object.fromEntries(
        ((await get('/cases/shade-usage').expect(200)).body.items as { shade: string; count: number }[]).map((i) => [i.shade, i.count]),
      );
      const d = await doctor(`Dr Shade ${tag()}`);
      await newCase(d, ['ZZ1', 'ZZ1', 'ZZ2', undefined]);
      const cancelled = await newCase(d, ['ZZ2', 'ZZ2', 'ZZ2']);
      await post(`/cases/${cancelled.id}/cancel`, { rowVersion: cancelled.rowVersion }).expect(200);

      const res = (await get('/cases/shade-usage?limit=50').expect(200)).body as { items: { shade: string; count: number }[] };
      const now = Object.fromEntries(res.items.map((i) => [i.shade, i.count]));
      expect((now['ZZ1'] ?? 0) - (before['ZZ1'] ?? 0)).toBe(2);
      expect((now['ZZ2'] ?? 0) - (before['ZZ2'] ?? 0)).toBe(1);
      const counts = res.items.map((i) => i.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(res.items.every((i) => i.shade.length > 0)).toBe(true);
    });

    it('defaults to 8 and rejects a limit above 24', async () => {
      const d = await doctor(`Dr Shade2 ${tag()}`);
      await newCase(d, ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'Y10']);
      expect(((await get('/cases/shade-usage').expect(200)).body.items as unknown[]).length).toBeLessThanOrEqual(8);
      await get('/cases/shade-usage?limit=25').expect(400);
    });
  });
});
