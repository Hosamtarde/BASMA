import request from 'supertest';
import { HttpMethod, requestFor, startTestApp, TestApp } from '../support/app';

jest.setTimeout(180_000);

describe('Settings (e2e)', () => {
  let t: TestApp;
  const api = (path: string) => `/api/v1${path}`;
  const getSettings = async () =>
    (await request(t.http).get(api('/settings')).set('Authorization', t.auth).expect(200)).body as {
      labProfile: { rowVersion: number } & Record<string, unknown>;
      currency: { rowVersion: number; locked: { code: boolean; decimals: boolean } } & Record<
        string,
        unknown
      >;
      language: { rowVersion: number } & Record<string, unknown>;
      numbering: Record<string, { startValue: number; nextValue: number; locked: boolean }>;
    };
  const patch = (path: string, body: object) =>
    request(t.http).patch(api(path)).set('Authorization', t.auth).send(body);

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('authorization on every route', () => {
    const routes: [HttpMethod, string][] = [
      ['get', '/settings'],
      ['patch', '/settings/lab-profile'],
      ['patch', '/settings/currency'],
      ['patch', '/settings/language'],
      ['patch', '/settings/numbering'],
    ];

    it.each(routes)('%s %s → 401 / 403', async (method, path) => {
      await requestFor(t.http, method, api(path)).send({}).expect(401);
      await requestFor(t.http, method, api(path)).set('Authorization', t.limitedAuth).send({}).expect(403);
    });
  });

  it('returns every group with its version and lock state', async () => {
    const s = await getSettings();
    expect(Object.keys(s).sort()).toEqual(['currency', 'labProfile', 'language', 'logo', 'numbering']);
    expect(s.numbering).toEqual({
      caseNo: { startValue: 1, nextValue: 1, locked: false },
      invoiceNo: { startValue: 1, nextValue: 1, locked: false },
    });
  });

  describe('lab profile', () => {
    it('updates fields and the time zone', async () => {
      const { labProfile } = await getSettings();
      const res = await patch('/settings/lab-profile', {
        rowVersion: labProfile.rowVersion,
        nameEn: ' Smile Lab ',
        phone: '02 222 3333',
        timeZone: 'Asia/Jerusalem',
      }).expect(200);
      expect(res.body.labProfile).toMatchObject({
        nameEn: 'Smile Lab',
        phone: '02 222 3333',
        timeZone: 'Asia/Jerusalem',
        rowVersion: labProfile.rowVersion + 1,
      });
    });

    it('requires a name in at least one language', async () => {
      const { labProfile } = await getSettings();
      const res = await patch('/settings/lab-profile', {
        rowVersion: labProfile.rowVersion,
        nameAr: null,
        nameEn: '',
      }).expect(400);
      expect(res.body.error.code).toBe('error.settings.lab_name_required');
    });

    it('rejects an unknown time zone, a null time zone and an outdated version', async () => {
      const { labProfile } = await getSettings();
      await patch('/settings/lab-profile', {
        rowVersion: labProfile.rowVersion,
        timeZone: 'Mars/Base',
      }).expect(400);
      await patch('/settings/lab-profile', { rowVersion: labProfile.rowVersion, timeZone: null }).expect(400);
      const stale = await patch('/settings/lab-profile', {
        rowVersion: labProfile.rowVersion - 1,
        nameAr: 'x',
      }).expect(409);
      expect(stale.body.error.code).toBe('error.concurrency.stale');
    });
  });

  describe('currency lock', () => {
    const currencyPatch = async (body: object, status: number) => {
      const { currency } = await getSettings();
      return patch('/settings/currency', { rowVersion: currency.rowVersion, ...body }).expect(status);
    };
    const locked = async () => (await getSettings()).currency.locked;

    it('can change code and decimals while no amount exists', async () => {
      expect(await locked()).toEqual({ code: false, decimals: false });
      const res = await currencyPatch({ code: 'JOD', decimals: 3, symbol: 'JD' }, 200);
      expect(res.body.currency).toMatchObject({ code: 'JOD', decimals: 3, symbol: 'JD' });
      await currencyPatch({ code: 'ILS', decimals: 2, symbol: '₪' }, 200);
    });

    it('locks code and decimals (never the symbol) once any amount exists, from each source', async () => {
      const doc = await request(t.http)
        .post(api('/doctors'))
        .set('Authorization', t.auth)
        .send({ name: 'Dr Money', openingBalance: 100 })
        .expect(201);
      expect(await locked()).toEqual({ code: true, decimals: true });

      const refused = await currencyPatch({ decimals: 3 }, 409);
      expect(refused.body.error).toMatchObject({
        code: 'error.settings.currency_locked',
        params: { fields: 'decimals' },
      });
      const symbol = await currencyPatch({ symbol: 'ش.ج' }, 200);
      expect(symbol.body.currency.symbol).toBe('ش.ج');

      // Opening balance back to 0 → unlocked again.
      await request(t.http)
        .patch(api(`/doctors/${doc.body.id as number}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, openingBalance: 0 })
        .expect(200);
      expect(await locked()).toEqual({ code: false, decimals: false });

      // A special price (even 0) is an amount.
      const wt = await request(t.http)
        .post(api('/work-types'))
        .set('Authorization', t.auth)
        .send({ name: 'Free crown', unitPrice: 0 })
        .expect(201);
      expect(await locked()).toEqual({ code: false, decimals: false });
      await request(t.http)
        .put(api(`/doctors/${doc.body.id as number}/prices/${wt.body.id as number}`))
        .set('Authorization', t.auth)
        .send({ price: 0 })
        .expect(200);
      expect(await locked()).toEqual({ code: true, decimals: true });
      await request(t.http)
        .delete(api(`/doctors/${doc.body.id as number}/prices/${wt.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(204);

      // A general price above 0.
      await request(t.http)
        .patch(api(`/work-types/${wt.body.id as number}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, unitPrice: 500 })
        .expect(200);
      expect(await locked()).toEqual({ code: true, decimals: true });
      const code = await currencyPatch({ code: 'USD' }, 409);
      expect(code.body.error.params).toEqual({ fields: 'code' });

      // Clean up so later tests start unlocked.
      await t.pool.query(`UPDATE work_types SET unit_price = 0`);
    });

    it('a currency change racing a money write never leaves an amount saved before a decimals change', async () => {
      for (let round = 0; round < 5; round++) {
        const { currency } = await getSettings();
        const decimals = currency.decimals === 2 ? 3 : 2;
        const [cur, price] = await Promise.all([
          patch('/settings/currency', { rowVersion: currency.rowVersion, decimals }),
          request(t.http)
            .post(api('/work-types'))
            .set('Authorization', t.auth)
            .send({ name: `Race ${round}`, unitPrice: 100 }),
        ]);
        expect(price.status).toBe(201);
        if (cur.status === 200) {
          // The amount must have been written after the currency change.
          const { rows } = await t.pool.query<{ action: string }>(
            `SELECT action FROM audit_log WHERE action IN ('settings.currency_updated', 'work_type.created')
             ORDER BY id DESC LIMIT 2`,
          );
          expect(rows.map((r) => r.action)).toEqual(['work_type.created', 'settings.currency_updated']);
        } else {
          expect(cur.status).toBe(409);
          expect(cur.body.error.code).toBe('error.settings.currency_locked');
        }
        await t.pool.query(`UPDATE work_types SET unit_price = 0`);
      }
    });
  });

  it('changes UI and document language independently', async () => {
    const { language } = await getSettings();
    const res = await patch('/settings/language', {
      rowVersion: language.rowVersion,
      documents: 'en',
    }).expect(200);
    expect(res.body.language).toMatchObject({ ui: 'ar', documents: 'en' });
    await patch('/settings/language', { rowVersion: language.rowVersion + 1, ui: 'fr' }).expect(400);
  });

  describe('numbering', () => {
    it('sets the first case number and moves the next number with it', async () => {
      const res = await patch('/settings/numbering', { caseNoStart: 1001 }).expect(200);
      expect(res.body.numbering.caseNo).toEqual({ startValue: 1001, nextValue: 1001, locked: false });
    });

    it('locks after a number is issued (409, localized) and changes nothing', async () => {
      await t.pool.query(`UPDATE counters SET next_value = next_value + 1 WHERE name = 'case_no'`);
      const res = await request(t.http)
        .patch(api('/settings/numbering'))
        .set('Authorization', t.auth)
        .set('Accept-Language', 'en')
        .send({ caseNoStart: 5, invoiceNoStart: 300 })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'error.settings.numbering_locked',
        message: 'The first number cannot change after a number has been issued.',
        params: { counter: 'case_no' },
      });
      const s = await getSettings();
      expect(s.numbering.caseNo).toEqual({ startValue: 1001, nextValue: 1002, locked: true });
      expect(s.numbering.invoiceNo).toEqual({ startValue: 1, nextValue: 1, locked: false });
    });

    it('rejects zero, negative and non-integer starts', async () => {
      for (const invoiceNoStart of [0, -1, 1.5, null]) {
        await patch('/settings/numbering', { invoiceNoStart }).expect(400);
      }
    });
  });
});
