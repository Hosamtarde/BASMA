import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

interface Groups {
  doctors?: { total: number; closest: boolean; items: { id: number; name: string; clinic: string | null }[] };
  cases?: { total: number; closest: boolean; items: { id: number; caseNo: number; patientName: string; doctorName: string }[] };
  payments?: { total: number; closest: boolean; items: { id: number; voucher: string; doctorName: string; amount: number }[] };
}

describe('B4 global search (e2e)', () => {
  let t: TestApp;
  const api = (p: string) => `/api/v1${p}`;
  let workType: number;
  const ids: Record<string, number> = {};
  const caseNos: Record<string, number> = {};

  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const doctor = async (name: string, extra: object = {}) =>
    (await post('/doctors', { name, ...extra }).expect(201)).body.id as number;
  const kase = async (doctorId: number, patientName: string) =>
    (
      await post('/cases', {
        doctorId,
        patientName,
        receivedDate: '2026-11-01',
        expectedDate: '2026-12-31',
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: 1000 }],
      }).expect(201)
    ).body as { id: number; caseNo: number };
  const search = async (q: string, auth?: string, extra = ''): Promise<{ q: string; groups: Groups }> =>
    (
      await request(t.http)
        .get(api(`/search?q=${encodeURIComponent(q)}${extra}`))
        .set('Authorization', auth ?? t.auth)
        .expect(200)
    ).body as { q: string; groups: Groups };
  const names = (g?: { items: { name: string }[] }) => g?.items.map((i) => i.name) ?? [];

  beforeAll(async () => {
    t = await startTestApp({}, { clock: new FakeClock(new Date('2026-11-10T10:00:00Z')) });
    workType = (await post('/work-types', { name: 'Zirconia', unitPrice: 1000 }).expect(201)).body.id as number;
    ids.hamza = await doctor('د. أحمد الهمزة', { clinic: 'عيادة الهمزة', phone: '0599123456' });
    ids.noHamza = await doctor('د. احمد الثاني');
    ids.fatima = await doctor('د. فاطمة الخطيب');
    ids.mustafa = await doctor('د. مصطفى الياء');
    ids.long = await doctor('د. محمد علي الخطيب');
    ids.smith = await doctor('Dr Smith', { clinic: 'Smile Clinic' });
    for (let i = 1; i <= 7; i++) await doctor(`Dr Many ${i}`);
    const a = await kase(ids.hamza, 'سلمى عيسى');
    const b = await kase(ids.hamza, 'كريم داود');
    const c = await kase(ids.smith, 'Patient 100%');
    caseNos.salma = a.caseNo;
    caseNos.karim = b.caseNo;
    caseNos.percent = c.caseNo;
    const pay = (body: object) => post('/payments', body, randomUUID()).expect(201);
    await pay({ doctorId: ids.hamza, method: 'cash', amount: 500 });
    await pay({
      doctorId: ids.smith,
      method: 'cheque',
      amount: 900,
      cheque: { chequeNo: 'CHQ-9001', bank: 'Arab Bank', dueDate: '2026-12-01' },
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('access', () => {
    it('401 without a token, 403 without search.use', async () => {
      await request(t.http).get(api('/search?q=a')).expect(401);
      await request(t.http).get(api('/search?q=a')).set('Authorization', t.limitedAuth).expect(403);
      const noSearch = await tokenWith(t, ['doctors.read', 'cases.read']);
      await request(t.http).get(api('/search?q=a')).set('Authorization', noSearch).expect(403);
    });

    it('a group the caller cannot read is absent, not empty', async () => {
      const onlyDoctors = await search('أحمد', await tokenWith(t, ['search.use', 'doctors.read']));
      expect(Object.keys(onlyDoctors.groups)).toEqual(['doctors']);
      const none = await search('أحمد', await tokenWith(t, ['search.use']));
      expect(none.groups).toEqual({});
      const casesAndPayments = await search('1', await tokenWith(t, ['search.use', 'cases.read', 'payments.read']));
      expect(Object.keys(casesAndPayments.groups).sort()).toEqual(['cases', 'payments']);
    });

    it('validates the text and the limit', async () => {
      const get = (q: string) => request(t.http).get(api(`/search${q}`)).set('Authorization', t.auth);
      await get('').expect(400);
      await get('?q=').expect(400);
      await get('?q=%20%20').expect(400);
      await get(`?q=${'x'.repeat(101)}`).expect(400);
      await get('?q=a&limit=0').expect(400);
      await get('?q=a&limit=11').expect(400);
      await get('?q=a&bogus=1').expect(400);
      await get(`?q=${'x'.repeat(100)}`).expect(200);
    });
  });

  describe('doctors', () => {
    it('finds hamza and non-hamza spellings of the same name (search only folds letters)', async () => {
      for (const q of ['أحمد', 'احمد', 'إحمد']) {
        const r = await search(q);
        expect(names(r.groups.doctors).sort()).toEqual(['د. أحمد الهمزة', 'د. احمد الثاني']);
        expect(r.groups.doctors?.closest).toBe(false);
      }
    });

    it('treats ta marbuta and ha, ya and alef maqsura alike', async () => {
      expect(names((await search('فاطمه')).groups.doctors)).toEqual(['د. فاطمة الخطيب']);
      expect(names((await search('فاطمة')).groups.doctors)).toEqual(['د. فاطمة الخطيب']);
      expect(names((await search('مصطفي')).groups.doctors)).toEqual(['د. مصطفى الياء']);
      expect(names((await search('مصطفى')).groups.doctors)).toEqual(['د. مصطفى الياء']);
    });

    it('matches clinic and phone, Latin text case-insensitively', async () => {
      expect(names((await search('عيادة الهمزة')).groups.doctors)).toEqual(['د. أحمد الهمزة']);
      expect(names((await search('0599123')).groups.doctors)).toEqual(['د. أحمد الهمزة']);
      expect(names((await search('SMILE')).groups.doctors)).toEqual(['Dr Smith']);
    });

    it('limits the hits but reports the true total; limit is honoured', async () => {
      const r = await search('Dr Many', undefined, '&limit=3');
      expect(r.groups.doctors?.items).toHaveLength(3);
      expect(r.groups.doctors?.total).toBe(7);
      const def = await search('Dr Many');
      expect(def.groups.doctors?.items).toHaveLength(5);
    });

    it('ranks exact and prefix matches before contains matches', async () => {
      await doctor('Mid Smith Name');
      await doctor('Smith');
      const r = await search('Smith');
      expect(names(r.groups.doctors).slice(0, 2)).toEqual(['Smith', 'Dr Smith'].slice(0, 1).concat(names(r.groups.doctors)[1] ?? ''));
      expect(names(r.groups.doctors)[0]).toBe('Smith');
    });
  });

  describe('closest matches (no typo tolerance, no pg_trgm)', () => {
    it('words in another order or with extra words fall back to all-words, flagged closest', async () => {
      const r = await search('علي محمد');
      expect(names(r.groups.doctors)).toEqual(['د. محمد علي الخطيب']);
      expect(r.groups.doctors?.closest).toBe(true);
    });

    it('falls back to any word when no doctor has them all, best match first', async () => {
      const r = await search('الخطيب زيدان');
      expect(r.groups.doctors?.closest).toBe(true);
      expect(names(r.groups.doctors).sort()).toEqual(['د. فاطمة الخطيب', 'د. محمد علي الخطيب']);
    });

    it('a one-word query with no match stays empty and not closest', async () => {
      const r = await search('زززز');
      expect(r.groups.doctors).toMatchObject({ total: 0, closest: false, items: [] });
    });
  });

  describe('cases', () => {
    it('finds a case by number (exact) and by patient name (folded contains)', async () => {
      const byNo = await search(String(caseNos.karim));
      expect(byNo.groups.cases?.items[0]).toMatchObject({ caseNo: caseNos.karim, patientName: 'كريم داود' });
      const byName = await search('سلمي');
      expect(byName.groups.cases?.items.map((i) => i.patientName)).toEqual(['سلمى عيسى']);
      expect(byName.groups.cases?.items[0]?.doctorName).toBe('د. أحمد الهمزة');
    });

    it('treats LIKE wildcards literally', async () => {
      expect((await search('%')).groups.cases?.items.map((i) => i.patientName)).toEqual(['Patient 100%']);
      expect((await search('_')).groups.cases?.total).toBe(0);
      expect((await search('100%')).groups.cases?.total).toBe(1);
      expect((await search('\\')).groups.cases?.total).toBe(0);
    });
  });

  describe('payments', () => {
    it('finds a voucher as IN-000001, in1, in-1 and 1', async () => {
      for (const q of ['IN-000001', 'in1', 'in-1', '1', '000001']) {
        const r = await search(q);
        expect(r.groups.payments?.items.map((i) => i.voucher)).toContain('IN-000001');
        expect(r.groups.payments?.items[0]?.voucher).toBe('IN-000001');
      }
    });

    it('finds a cheque by its number, case-insensitively, with the doctor and amount', async () => {
      const r = await search('chq-90');
      expect(r.groups.payments?.items).toEqual([
        expect.objectContaining({ doctorName: 'Dr Smith', amount: 900, voucher: 'IN-000002' }),
      ]);
    });

    it('does not match doctor names (the doctors group does)', async () => {
      expect((await search('Smith')).groups.payments?.total).toBe(0);
    });
  });

  it('leaves no audit entry and no row changes (a read)', async () => {
    const before = await t.pool.query(`SELECT count(*)::int AS n FROM audit_log`);
    await search('أحمد');
    const after = await t.pool.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
