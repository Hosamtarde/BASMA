import request from 'supertest';
import { HttpMethod, markUsed, requestFor, startTestApp, statusesOf, TestApp } from '../support/app';

jest.setTimeout(180_000);

describe('Doctors and special prices (e2e)', () => {
  let t: TestApp;
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object) =>
    request(t.http).post(api(path)).set('Authorization', t.auth).send(body);

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('authorization on every route', () => {
    const routes: [HttpMethod, string][] = [
      ['get', '/doctors'],
      ['post', '/doctors'],
      ['get', '/doctors/1'],
      ['patch', '/doctors/1'],
      ['delete', '/doctors/1'],
      ['get', '/doctors/1/prices'],
      ['put', '/doctors/1/prices/1'],
      ['delete', '/doctors/1/prices/1'],
    ];

    it.each(routes)('%s %s → 401 without a token', async (method, path) => {
      await requestFor(t.http, method, api(path)).send({}).expect(401);
    });

    it.each(routes)('%s %s → 403 without the doctors permission', async (method, path) => {
      const res = await requestFor(t.http, method, api(path)).set('Authorization', t.limitedAuth).send({});
      expect(res.status).toBe(403);
    });
  });

  describe('directory', () => {
    it('creates a doctor with normalized text fields and a signed opening balance', async () => {
      const res = await post('/doctors', {
        name: '  د.   أحمد سالم ',
        phone: ' 0599 123 456 ',
        clinic: '',
        notes: 'Prefers A2',
        openingBalance: -2500,
      }).expect(201);
      expect(res.body).toEqual({
        id: expect.any(Number),
        name: 'د. أحمد سالم',
        phone: '0599 123 456',
        clinic: null,
        notes: 'Prefers A2',
        openingBalance: -2500,
        active: true,
        rowVersion: 1,
      });
    });

    it('rejects duplicates (case-insensitive), bad phones, floats and unknown fields', async () => {
      await post('/doctors', { name: 'Dr Lina' }).expect(201);
      const dup = await post('/doctors', { name: 'DR  LINA' }).expect(409);
      expect(dup.body.error.code).toBe('error.doctor.name_taken');

      const bad = await post('/doctors', {
        name: 'Dr X',
        phone: 'call me',
        openingBalance: 10.5,
        balance: 1,
      }).expect(400);
      const fields = (bad.body.error.details.fields as { field: string }[]).map((f) => f.field).sort();
      expect(fields).toEqual(['balance', 'openingBalance', 'phone']);
    });

    it('allows two doctors with the same phone (not unique)', async () => {
      await post('/doctors', { name: 'Dr Clinic A', phone: '022 111' }).expect(201);
      await post('/doctors', { name: 'Dr Clinic B', phone: '022 111' }).expect(201);
    });

    it('searches by name, phone or clinic and filters by active', async () => {
      await post('/doctors', { name: 'Dr Sami', clinic: 'Smile Center' }).expect(201);
      const byClinic = await request(t.http)
        .get(api('/doctors?search=smile'))
        .set('Authorization', t.auth)
        .expect(200);
      expect(byClinic.body.items.map((d: { name: string }) => d.name)).toEqual(['Dr Sami']);
      const byPhone = await request(t.http)
        .get(api('/doctors?search=022'))
        .set('Authorization', t.auth)
        .expect(200);
      expect(byPhone.body.total).toBe(2);
    });

    it('edits fields, clears with null, audits opening balance old → new', async () => {
      const created = await post('/doctors', { name: 'Dr Edit', phone: '059', openingBalance: 1000 }).expect(
        201,
      );
      const id = created.body.id as number;
      const res = await request(t.http)
        .patch(api(`/doctors/${id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, phone: null, openingBalance: 1500 })
        .expect(200);
      expect(res.body).toMatchObject({ phone: null, openingBalance: 1500, rowVersion: 2 });

      const { rows } = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'doctor.updated' AND entity_id = $1`,
        [String(id)],
      );
      expect(rows[0]?.params).toMatchObject({ openingBalanceOld: 1000, openingBalanceNew: 1500 });

      await request(t.http)
        .patch(api(`/doctors/${id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, notes: 'late' })
        .expect(409);
      await request(t.http)
        .patch(api(`/doctors/${id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 2, name: null })
        .expect(400);
    });

    it('two concurrent edits of the same version → one 200, one 409', async () => {
      const created = await post('/doctors', { name: 'Dr Race' }).expect(201);
      const id = created.body.id as number;
      const results = await Promise.all(
        ['A', 'B'].map((n) =>
          request(t.http)
            .patch(api(`/doctors/${id}`))
            .set('Authorization', t.auth)
            .send({ rowVersion: 1, notes: n }),
        ),
      );
      expect(statusesOf(results)).toEqual([200, 409]);
    });
  });

  describe('delete or deactivate', () => {
    it('hard-deletes an unused doctor with a zero opening balance (and its special prices)', async () => {
      const d = await post('/doctors', { name: 'Dr Gone' }).expect(201);
      const wt = await post('/work-types', { name: 'Gone crown', unitPrice: 100 }).expect(201);
      await request(t.http)
        .put(api(`/doctors/${d.body.id as number}/prices/${wt.body.id as number}`))
        .set('Authorization', t.auth)
        .send({ price: 90 })
        .expect(200);
      const res = await request(t.http)
        .delete(api(`/doctors/${d.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(res.body).toEqual({ outcome: 'deleted' });
      await request(t.http)
        .get(api(`/doctors/${d.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(404);
    });

    it('never hard-deletes a doctor with a non-zero opening balance (addition A)', async () => {
      for (const openingBalance of [500, -500]) {
        const d = await post('/doctors', { name: `Dr Balance ${openingBalance}`, openingBalance }).expect(
          201,
        );
        const res = await request(t.http)
          .delete(api(`/doctors/${d.body.id as number}`))
          .set('Authorization', t.auth)
          .expect(200);
        expect(res.body).toEqual({ outcome: 'deactivated' });
        const after = await request(t.http)
          .get(api(`/doctors/${d.body.id as number}`))
          .set('Authorization', t.auth)
          .expect(200);
        expect(after.body).toMatchObject({ active: false, openingBalance });
      }
    });

    it('deactivates a doctor referenced by other records', async () => {
      const d = await post('/doctors', { name: 'Dr Used' }).expect(201);
      await markUsed(t.pool, 'doctors', d.body.id as number);
      const res = await request(t.http)
        .delete(api(`/doctors/${d.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(res.body).toEqual({ outcome: 'deactivated' });
    });
  });

  describe('special prices', () => {
    let doctorId: number;
    let crownId: number;
    let bridgeId: number;

    beforeAll(async () => {
      doctorId = (await post('/doctors', { name: 'Dr Prices' }).expect(201)).body.id as number;
      crownId = (await post('/work-types', { name: 'Crown P', unitPrice: 20000, sortOrder: 1 }).expect(201))
        .body.id as number;
      bridgeId = (await post('/work-types', { name: 'Bridge P', unitPrice: 15000, sortOrder: 2 }).expect(201))
        .body.id as number;
    });

    it('lists every active work type with the general price and no special price yet', async () => {
      const res = await request(t.http)
        .get(api(`/doctors/${doctorId}/prices`))
        .set('Authorization', t.auth)
        .expect(200);
      const crown = (res.body as { workTypeId: number }[]).find((r) => r.workTypeId === crownId);
      expect(crown).toEqual({
        workTypeId: crownId,
        workTypeName: 'Crown P',
        workTypeActive: true,
        generalPrice: 20000,
        specialPrice: null,
      });
    });

    it('sets, changes and removes a special price, auditing old and new values', async () => {
      const set = await request(t.http)
        .put(api(`/doctors/${doctorId}/prices/${crownId}`))
        .set('Authorization', t.auth)
        .send({ price: 18000 })
        .expect(200);
      expect(set.body).toMatchObject({ workTypeId: crownId, generalPrice: 20000, specialPrice: 18000 });

      await request(t.http)
        .put(api(`/doctors/${doctorId}/prices/${crownId}`))
        .set('Authorization', t.auth)
        .send({ price: 17500 })
        .expect(200);
      await request(t.http)
        .delete(api(`/doctors/${doctorId}/prices/${crownId}`))
        .set('Authorization', t.auth)
        .expect(204);
      // Idempotent.
      await request(t.http)
        .delete(api(`/doctors/${doctorId}/prices/${crownId}`))
        .set('Authorization', t.auth)
        .expect(204);

      const { rows } = await t.pool.query<{ action: string; params: Record<string, unknown> }>(
        `SELECT action, params FROM audit_log WHERE entity = 'doctor' AND entity_id = $1
           AND action LIKE 'doctor.price%' ORDER BY id`,
        [String(doctorId)],
      );
      expect(rows.map((r) => [r.action, r.params.priceOld, r.params.priceNew])).toEqual([
        ['doctor.price_set', null, 18000],
        ['doctor.price_set', 18000, 17500],
        ['doctor.price_removed', 17500, undefined],
      ]);
    });

    it('rejects negative/float prices and unknown doctor or work type', async () => {
      await request(t.http)
        .put(api(`/doctors/${doctorId}/prices/${bridgeId}`))
        .set('Authorization', t.auth)
        .send({ price: -1 })
        .expect(400);
      await request(t.http)
        .put(api(`/doctors/${doctorId}/prices/${bridgeId}`))
        .set('Authorization', t.auth)
        .send({ price: 99.9 })
        .expect(400);
      await request(t.http)
        .put(api(`/doctors/999999/prices/${bridgeId}`))
        .set('Authorization', t.auth)
        .send({ price: 1 })
        .expect(404);
      await request(t.http)
        .put(api(`/doctors/${doctorId}/prices/999999`))
        .set('Authorization', t.auth)
        .send({ price: 1 })
        .expect(404);
    });

    it('keeps showing an inactive work type while it still has a special price', async () => {
      await request(t.http)
        .put(api(`/doctors/${doctorId}/prices/${bridgeId}`))
        .set('Authorization', t.auth)
        .send({ price: 14000 })
        .expect(200);
      await request(t.http)
        .patch(api(`/work-types/${bridgeId}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, active: false })
        .expect(200);
      const res = await request(t.http)
        .get(api(`/doctors/${doctorId}/prices`))
        .set('Authorization', t.auth)
        .expect(200);
      const bridge = (res.body as { workTypeId: number }[]).find((r) => r.workTypeId === bridgeId);
      expect(bridge).toMatchObject({ workTypeActive: false, specialPrice: 14000 });
    });
  });
});
