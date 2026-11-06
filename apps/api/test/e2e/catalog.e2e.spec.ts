import request from 'supertest';
import { HttpMethod, markUsed, requestFor, startTestApp, statusesOf, TestApp } from '../support/app';

jest.setTimeout(180_000);

describe('Catalog: technicians, work types, expense categories (e2e)', () => {
  let t: TestApp;
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('authorization on every route', () => {
    const routes: [HttpMethod, string][] = [];
    for (const base of ['/technicians', '/work-types', '/expense-categories']) {
      routes.push(['get', base], ['post', base], ['patch', `${base}/1`], ['delete', `${base}/1`]);
    }

    it.each(routes)('%s %s → 401 without a token', async (method, path) => {
      const res = await requestFor(t.http, method, api(path)).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('error.auth.unauthenticated');
    });

    it.each(routes)('%s %s → 403 without the catalog permission', async (method, path) => {
      const res = await requestFor(t.http, method, api(path)).set('Authorization', t.limitedAuth).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('error.auth.forbidden');
    });
  });

  describe('technicians', () => {
    it('creates with a normalized name and lists it', async () => {
      const created = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: '  Ahmad   Saleh ' })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(Number),
        name: 'Ahmad Saleh',
        active: true,
        rowVersion: 1,
      });

      const list = await request(t.http).get(api('/technicians')).set('Authorization', t.auth).expect(200);
      expect(list.body).toEqual({ items: [created.body], page: 1, pageSize: 25, total: 1 });
    });

    it('rejects a duplicate that differs only by Latin case or spacing (409, localized)', async () => {
      const ar = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'ahmad saleh' })
        .expect(409);
      expect(ar.body.error).toMatchObject({
        code: 'error.technician.name_taken',
        message: 'يوجد فني بالاسم «ahmad saleh» مسبقاً.',
        params: { name: 'ahmad saleh' },
      });
      const en = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .set('Accept-Language', 'en')
        .send({ name: 'AHMAD  SALEH' })
        .expect(409);
      expect(en.body.error.message).toBe('A technician named «AHMAD SALEH» already exists.');
    });

    it('treats Arabic letter variants as different names (no folding)', async () => {
      await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'أحمد' })
        .expect(201);
      await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'احمد' })
        .expect(201);
      await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: ' أحمد ' })
        .expect(409);
    });

    it('rejects blank names and unknown fields', async () => {
      const res = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: '   ', active: false })
        .expect(400);
      const fields = (res.body.error.details.fields as { field: string }[]).map((f) => f.field).sort();
      expect(fields).toEqual(['active', 'name']);
    });

    it('updates with the current rowVersion and refuses an outdated one', async () => {
      const created = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'Rami' })
        .expect(201);
      const id = created.body.id as number;

      const updated = await request(t.http)
        .patch(api(`/technicians/${id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, name: 'Rami K' })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'Rami K', rowVersion: 2 });

      const stale = await request(t.http)
        .patch(api(`/technicians/${id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, name: 'Rami X' })
        .expect(409);
      expect(stale.body.error.code).toBe('error.concurrency.stale');

      // Nothing changed → no new version.
      const noop = await request(t.http)
        .patch(api(`/technicians/${id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: 2, name: 'Rami K' })
        .expect(200);
      expect(noop.body.rowVersion).toBe(2);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(t.http)
        .patch(api('/technicians/999999'))
        .set('Authorization', t.auth)
        .send({ rowVersion: 1, name: 'x' })
        .expect(404);
      expect(res.body.error.code).toBe('error.not_found');
      await request(t.http).delete(api('/technicians/999999')).set('Authorization', t.auth).expect(404);
    });

    it('deletes an unused technician but only deactivates a used one', async () => {
      const unused = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'Temp' })
        .expect(201);
      const del = await request(t.http)
        .delete(api(`/technicians/${unused.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(del.body).toEqual({ outcome: 'deleted' });

      const used = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'Veteran' })
        .expect(201);
      await markUsed(t.pool, 'technicians', used.body.id as number);
      const deact = await request(t.http)
        .delete(api(`/technicians/${used.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(deact.body).toEqual({ outcome: 'deactivated' });

      const inactive = await request(t.http)
        .get(api('/technicians?active=false'))
        .set('Authorization', t.auth)
        .expect(200);
      expect(inactive.body.items.map((x: { name: string }) => x.name)).toEqual(['Veteran']);

      const audit = await t.pool.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity = 'technician' AND action LIKE 'technician.de%' ORDER BY id`,
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['technician.deleted', 'technician.deactivated']);
    });

    it('two concurrent creations of the same name → one 201, one 409', async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          request(t.http).post(api('/technicians')).set('Authorization', t.auth).send({ name: 'Twin' }),
        ),
      );
      expect(statusesOf(results)).toEqual([201, 409]);
    });

    it('two concurrent edits of the same version → one 200, one 409', async () => {
      const created = await request(t.http)
        .post(api('/technicians'))
        .set('Authorization', t.auth)
        .send({ name: 'Racer' })
        .expect(201);
      const id = created.body.id as number;
      const results = await Promise.all(
        ['Racer A', 'Racer B'].map((name) =>
          request(t.http)
            .patch(api(`/technicians/${id}`))
            .set('Authorization', t.auth)
            .send({ rowVersion: 1, name }),
        ),
      );
      expect(statusesOf(results)).toEqual([200, 409]);
    });
  });

  describe('work types', () => {
    it('starts empty (no seeded work types or prices)', async () => {
      const res = await request(t.http).get(api('/work-types')).set('Authorization', t.auth).expect(200);
      expect(res.body.total).toBe(0);
    });

    it('creates with integer minor-unit prices and sorts by sortOrder, then name', async () => {
      for (const [name, unitPrice, sortOrder] of [
        ['Zirconia', 25000, 2],
        ['E-max', 30000, 1],
        ['Acrylic', 0, 2],
      ] as const) {
        await request(t.http)
          .post(api('/work-types'))
          .set('Authorization', t.auth)
          .send({ name, unitPrice, sortOrder })
          .expect(201);
      }
      const res = await request(t.http).get(api('/work-types')).set('Authorization', t.auth).expect(200);
      expect(res.body.items.map((w: { name: string }) => w.name)).toEqual(['E-max', 'Acrylic', 'Zirconia']);
      expect(res.body.items[0]).toEqual({
        id: expect.any(Number),
        name: 'E-max',
        unitPrice: 30000,
        sortOrder: 1,
        active: true,
        rowVersion: 1,
      });
    });

    it.each([[-1], [10.5], ['100'], [1_000_000_000_000], [null]])(
      'rejects unitPrice %p',
      async (unitPrice) => {
        const res = await request(t.http)
          .post(api('/work-types'))
          .set('Authorization', t.auth)
          .send({ name: `Bad ${String(unitPrice)}`, unitPrice })
          .expect(400);
        expect(res.body.error.details.fields[0].field).toBe('unitPrice');
      },
    );

    it('audits price changes with old and new values', async () => {
      const list = await request(t.http)
        .get(api('/work-types?search=zircon'))
        .set('Authorization', t.auth)
        .expect(200);
      const z = list.body.items[0] as { id: number; rowVersion: number };
      await request(t.http)
        .patch(api(`/work-types/${z.id}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: z.rowVersion, unitPrice: 27500 })
        .expect(200);
      const { rows } = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'work_type.updated' ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0]?.params).toMatchObject({
        unitPriceOld: 25000,
        unitPriceNew: 27500,
        fields: 'unitPrice',
      });
    });

    it('deleting an unused work type also removes its special prices', async () => {
      const wt = await request(t.http)
        .post(api('/work-types'))
        .set('Authorization', t.auth)
        .send({ name: 'Wax', unitPrice: 1000 })
        .expect(201);
      const doc = await t.pool.query<{ id: string }>(
        `INSERT INTO doctors (name) VALUES ('Dr Wax') RETURNING id`,
      );
      await t.pool.query(`INSERT INTO doctor_prices (doctor_id, work_type_id, price) VALUES ($1, $2, 900)`, [
        doc.rows[0]?.id,
        wt.body.id,
      ]);
      const res = await request(t.http)
        .delete(api(`/work-types/${wt.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(res.body).toEqual({ outcome: 'deleted' });
      const left = await t.pool.query(`SELECT 1 FROM doctor_prices WHERE work_type_id = $1`, [wt.body.id]);
      expect(left.rows).toHaveLength(0);
    });

    it('a used work type is deactivated and keeps its special prices', async () => {
      const wt = await request(t.http)
        .post(api('/work-types'))
        .set('Authorization', t.auth)
        .send({ name: 'Titanium', unitPrice: 5000 })
        .expect(201);
      const doc = await t.pool.query<{ id: string }>(
        `INSERT INTO doctors (name) VALUES ('Dr Ti') RETURNING id`,
      );
      await t.pool.query(`INSERT INTO doctor_prices (doctor_id, work_type_id, price) VALUES ($1, $2, 4500)`, [
        doc.rows[0]?.id,
        wt.body.id,
      ]);
      await markUsed(t.pool, 'work_types', wt.body.id as number);
      const res = await request(t.http)
        .delete(api(`/work-types/${wt.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(res.body).toEqual({ outcome: 'deactivated' });
      const kept = await t.pool.query(`SELECT price FROM doctor_prices WHERE work_type_id = $1`, [
        wt.body.id,
      ]);
      expect(kept.rows).toEqual([{ price: '4500' }]);
    });

    it('paginates and matches search text literally (% and _ are not wildcards)', async () => {
      const page = await request(t.http)
        .get(api('/work-types?pageSize=2&page=2'))
        .set('Authorization', t.auth)
        .expect(200);
      expect(page.body).toMatchObject({ page: 2, pageSize: 2 });
      expect(page.body.total).toBeGreaterThanOrEqual(3);
      const literal = await request(t.http)
        .get(api('/work-types?search=%25'))
        .set('Authorization', t.auth)
        .expect(200);
      expect(literal.body.total).toBe(0);
      await request(t.http).get(api('/work-types?pageSize=101')).set('Authorization', t.auth).expect(400);
    });
  });

  describe('expense categories', () => {
    let doctorCategoryId: number;

    beforeAll(async () => {
      const existing = await t.pool.query<{ id: string }>(
        `SELECT id FROM expense_categories WHERE is_doctor`,
      );
      if (existing.rows[0]) {
        doctorCategoryId = Number(existing.rows[0].id);
      } else {
        const r = await t.pool.query<{ id: string }>(
          `INSERT INTO expense_categories (name, is_doctor) VALUES ('Doctor (refund)', true) RETURNING id`,
        );
        doctorCategoryId = Number(r.rows[0]?.id);
      }
    });

    it('creates ordinary categories (never as the doctor category)', async () => {
      const res = await request(t.http)
        .post(api('/expense-categories'))
        .set('Authorization', t.auth)
        .send({ name: 'Gas' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Gas', isDoctor: false, active: true });
      await request(t.http)
        .post(api('/expense-categories'))
        .set('Authorization', t.auth)
        .send({ name: 'Sneaky', isDoctor: true })
        .expect(400);
    });

    it('the doctor-refund category can be renamed but not deactivated or deleted', async () => {
      const list = await request(t.http)
        .get(api('/expense-categories'))
        .set('Authorization', t.auth)
        .expect(200);
      const cat = (list.body.items as { id: number; rowVersion: number }[]).find(
        (c) => c.id === doctorCategoryId,
      );
      expect(cat).toBeDefined();

      const off = await request(t.http)
        .patch(api(`/expense-categories/${doctorCategoryId}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: cat?.rowVersion, active: false })
        .expect(409);
      expect(off.body.error.code).toBe('error.expense_category.system');

      const del = await request(t.http)
        .delete(api(`/expense-categories/${doctorCategoryId}`))
        .set('Authorization', t.auth)
        .expect(409);
      expect(del.body.error.code).toBe('error.expense_category.system');

      const renamed = await request(t.http)
        .patch(api(`/expense-categories/${doctorCategoryId}`))
        .set('Authorization', t.auth)
        .send({ rowVersion: cat?.rowVersion, name: 'Refund to doctor' })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Refund to doctor', isDoctor: true, active: true });
    });

    it('deletes an unused category', async () => {
      const c = await request(t.http)
        .post(api('/expense-categories'))
        .set('Authorization', t.auth)
        .send({ name: 'Once' })
        .expect(201);
      const res = await request(t.http)
        .delete(api(`/expense-categories/${c.body.id as number}`))
        .set('Authorization', t.auth)
        .expect(200);
      expect(res.body).toEqual({ outcome: 'deleted' });
    });
  });
});
