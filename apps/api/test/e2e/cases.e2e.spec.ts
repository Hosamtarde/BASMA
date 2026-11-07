import request from 'supertest';
import { FakeClock, HttpMethod, requestFor, startTestApp, statusesOf, TestApp } from '../support/app';

jest.setTimeout(240_000);

/** 2026-11-10 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-10T10:00:00Z';
const TODAY = '2026-11-10';

describe('Cases (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (path: string) => `/api/v1${path}`;
  const post = (path: string, body: object) =>
    request(t.http).post(api(path)).set('Authorization', t.auth).send(body);
  const patch = (path: string, body: object) =>
    request(t.http).patch(api(path)).set('Authorization', t.auth).send(body);
  const get = (path: string) => request(t.http).get(api(path)).set('Authorization', t.auth);

  let d1: number;
  let w1: number; // general 20000
  let w2: number; // general 15000, special for d1 = 12000
  let tech: number;

  const baseCase = (overrides: Record<string, unknown> = {}) => ({
    doctorId: d1,
    patientName: 'Patient A',
    expectedDate: '2026-11-15',
    lines: [{ toothNo: 11, workTypeId: w1 }],
    ...overrides,
  });

  type Detail = {
    id: number;
    caseNo: number;
    rowVersion: number;
    total: number;
    subtotal: number;
    discount: number;
    status: string;
    deliveredDate: string | null;
    overdue: boolean;
    lines: { id: number; unitPrice: number; priceSource: string }[];
    history: { fromStatus: string | null; toStatus: string; deliveredDate: string | null }[];
  };
  const detail = async (id: number) => (await get(`/cases/${id}`).expect(200)).body as Detail;

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', {
      rowVersion: s.body.labProfile.rowVersion,
      timeZone: 'Asia/Hebron',
    }).expect(200);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('currency lock from cases (runs first, while no amount exists)', () => {
    it('a case alone locks currency code/decimals, also when racing a currency change', async () => {
      const d0 = (await post('/doctors', { name: 'Dr Zero' }).expect(201)).body.id as number;
      const w0 = (await post('/work-types', { name: 'Free model', unitPrice: 0 }).expect(201)).body
        .id as number;
      const before = await get('/settings').expect(200);
      expect(before.body.currency.locked).toEqual({ code: false, decimals: false });

      const [cur, created] = await Promise.all([
        patch('/settings/currency', { rowVersion: before.body.currency.rowVersion, decimals: 3 }),
        post('/cases', {
          doctorId: d0,
          patientName: 'Z',
          expectedDate: TODAY,
          lines: [{ area: 'none', workTypeId: w0 }],
        }),
      ]);
      expect(created.status).toBe(201);
      if (cur.status === 200) {
        const { rows } = await t.pool.query<{ action: string }>(
          `SELECT action FROM audit_log WHERE action IN ('settings.currency_updated','case.created') ORDER BY id`,
        );
        expect(rows.map((r) => r.action)).toEqual(['settings.currency_updated', 'case.created']);
      } else {
        expect(cur.body.error.code).toBe('error.settings.currency_locked');
      }
      const after = await get('/settings').expect(200);
      expect(after.body.currency.locked).toEqual({ code: true, decimals: true });
    });
  });

  describe('fixtures', () => {
    it('creates doctors, technicians and work types', async () => {
      d1 = (await post('/doctors', { name: 'Dr One' }).expect(201)).body.id as number;
      w1 = (await post('/work-types', { name: 'Zirconia', unitPrice: 20000 }).expect(201)).body.id as number;
      w2 = (await post('/work-types', { name: 'E-max', unitPrice: 15000 }).expect(201)).body.id as number;
      tech = (await post('/technicians', { name: 'Tech One' }).expect(201)).body.id as number;
      await request(t.http)
        .put(api(`/doctors/${d1}/prices/${w2}`))
        .set('Authorization', t.auth)
        .send({ price: 12000 })
        .expect(200);
    });
  });

  describe('authorization on every route', () => {
    const routes: [HttpMethod, string][] = [
      ['get', '/cases'],
      ['post', '/cases'],
      ['get', '/cases/1'],
      ['patch', '/cases/1'],
      ['post', '/cases/1/lines'],
      ['patch', '/cases/1/lines/1'],
      ['delete', '/cases/1/lines/1?rowVersion=1'],
      ['post', '/cases/1/status'],
      ['post', '/cases/1/cancel'],
    ];
    it.each(routes)('%s %s → 401 / 403', async (method, path) => {
      await requestFor(t.http, method, api(path)).send({}).expect(401);
      await requestFor(t.http, method, api(path)).set('Authorization', t.limitedAuth).send({}).expect(403);
    });
  });

  describe('create', () => {
    it('resolves general, special and manual prices on the server, with tooth and area lines', async () => {
      const res = await post(
        '/cases',
        baseCase({
          patientName: '  Patient   Alpha ',
          technicianId: tech,
          discount: 1000,
          notes: 'rush',
          lines: [
            { toothNo: 11, workTypeId: w1, shade: '  A2 ' },
            { toothNo: 12, workTypeId: w2 },
            { area: 'upper_arch', workTypeId: w1, unitPrice: 5000, note: 'night guard' },
          ],
        }),
      ).expect(201);
      expect(res.body).toMatchObject({
        patientName: 'Patient Alpha',
        doctor: { id: d1, name: 'Dr One' },
        technician: { id: tech, name: 'Tech One' },
        receivedDate: TODAY,
        expectedDate: '2026-11-15',
        deliveredDate: null,
        status: 'design',
        subtotal: 37000,
        discount: 1000,
        total: 36000,
        overdue: false,
        rowVersion: 1,
      });
      expect(
        (res.body.lines as Record<string, unknown>[]).map((l) => [
          l.toothNo,
          l.area,
          l.unitPrice,
          l.priceSource,
          l.shade,
        ]),
      ).toEqual([
        [11, null, 20000, 'general', 'A2'],
        [12, null, 12000, 'special', null],
        [null, 'upper_arch', 5000, 'manual', null],
      ]);
      expect(res.body.history).toEqual([
        { fromStatus: null, toStatus: 'design', at: expect.any(String), note: null, deliveredDate: null },
      ]);
      // The UI reads the allowed actions instead of re-implementing the state machine.
      expect(res.body).toMatchObject({
        allowedStatuses: ['waiting', 'in_progress', 'ready', 'delivered'],
        canCancel: true,
        canEdit: true,
      });
    });

    it('assigns consecutive case numbers, also under concurrency (gap-free)', async () => {
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) => post('/cases', baseCase({ patientName: `Burst ${i}` }))),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const numbers = results.map((r) => r.body.caseNo as number).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(15);
      expect(numbers.at(-1)! - numbers[0]!).toBe(14);
    });

    it('a create that fails after taking a number leaves no gap', async () => {
      await t.pool.query(`
        CREATE OR REPLACE FUNCTION test_fail_boom() RETURNS trigger AS $$
        BEGIN IF NEW.note = 'boom' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_fail_boom BEFORE INSERT ON case_items FOR EACH ROW EXECUTE FUNCTION test_fail_boom();`);
      const before = await t.pool.query<{ next_value: string }>(
        `SELECT next_value FROM counters WHERE name='case_no'`,
      );
      await post('/cases', baseCase({ lines: [{ toothNo: 11, workTypeId: w1, note: 'boom' }] })).expect(500);
      await t.pool.query(`DROP TRIGGER test_fail_boom ON case_items`);
      const ok = await post('/cases', baseCase()).expect(201);
      expect(ok.body.caseNo).toBe(Number(before.rows[0]?.next_value));
    });

    it.each([
      ['tooth and area', [{ toothNo: 11, area: 'none', workTypeId: 1 }], 'error.case.line_position'],
      ['neither tooth nor area', [{ workTypeId: 1 }], 'error.case.line_position'],
    ])('rejects a line with %s', async (_label, lines, code) => {
      const res = await post(
        '/cases',
        baseCase({ lines: lines.map((l) => ({ ...l, workTypeId: w1 })) }),
      ).expect(400);
      expect(res.body.error).toMatchObject({ code, params: { line: 1 } });
    });

    it.each([
      ['tooth 19', { toothNo: 19 }, 'lines.0.toothNo'],
      ['tooth 51 (primary)', { toothNo: 51 }, 'lines.0.toothNo'],
      ['unknown area', { area: 'left' }, 'lines.0.area'],
      ['shade over 20 chars', { toothNo: 11, shade: 'x'.repeat(21) }, 'lines.0.shade'],
      ['float price', { toothNo: 11, unitPrice: 10.5 }, 'lines.0.unitPrice'],
    ])('validates %s', async (_label, line, field) => {
      const res = await post('/cases', baseCase({ lines: [{ workTypeId: w1, ...line }] })).expect(400);
      expect((res.body.error.details.fields as { field: string }[]).map((f) => f.field)).toContain(field);
    });

    it('accepts free-text shades up to 20 characters', async () => {
      const res = await post(
        '/cases',
        baseCase({ lines: [{ toothNo: 21, workTypeId: w1, shade: '3M2 / custom mix' }] }),
      );
      expect(res.status).toBe(201);
      expect(res.body.lines[0].shade).toBe('3M2 / custom mix');
    });

    it('limits a case to 100 lines (addition B)', async () => {
      const line = { area: 'none', workTypeId: w1 };
      await post('/cases', baseCase({ lines: Array(101).fill(line) })).expect(400);
      const full = await post('/cases', baseCase({ lines: Array(100).fill(line) })).expect(201);
      const more = await post(`/cases/${full.body.id as number}/lines`, {
        rowVersion: 1,
        lines: [line],
      }).expect(409);
      expect(more.body.error).toMatchObject({ code: 'error.case.too_many_lines', params: { max: 100 } });
    });

    it('refuses inactive doctor, technician and work type; 404 for unknown ones', async () => {
      const dIn = (await post('/doctors', { name: 'Dr Off' }).expect(201)).body.id as number;
      await patch(`/doctors/${dIn}`, { rowVersion: 1, active: false }).expect(200);
      const tIn = (await post('/technicians', { name: 'Tech Off' }).expect(201)).body.id as number;
      await patch(`/technicians/${tIn}`, { rowVersion: 1, active: false }).expect(200);
      const wIn = (await post('/work-types', { name: 'Old type', unitPrice: 100 }).expect(201)).body
        .id as number;
      await patch(`/work-types/${wIn}`, { rowVersion: 1, active: false }).expect(200);

      expect((await post('/cases', baseCase({ doctorId: dIn })).expect(409)).body.error.code).toBe(
        'error.case.doctor_inactive',
      );
      expect((await post('/cases', baseCase({ technicianId: tIn })).expect(409)).body.error.code).toBe(
        'error.case.technician_inactive',
      );
      const wt = await post('/cases', baseCase({ lines: [{ toothNo: 11, workTypeId: wIn }] })).expect(409);
      expect(wt.body.error).toMatchObject({
        code: 'error.case.work_type_inactive',
        params: { name: 'Old type' },
      });
      await post('/cases', baseCase({ doctorId: 999999 })).expect(404);
      await post('/cases', baseCase({ lines: [{ toothNo: 11, workTypeId: 999999 }] })).expect(404);
    });

    it('checks dates against the lab’s today', async () => {
      const future = await post('/cases', baseCase({ receivedDate: '2026-11-11' })).expect(400);
      expect(future.body.error.code).toBe('error.case.received_in_future');
      const early = await post(
        '/cases',
        baseCase({ receivedDate: '2026-11-08', expectedDate: '2026-11-07' }),
      ).expect(400);
      expect(early.body.error.code).toBe('error.case.expected_before_received');
      await post('/cases', baseCase({ receivedDate: '2026-02-30' })).expect(400);
      await post('/cases', baseCase({ status: 'delivered' })).expect(400);
    });

    it('never writes the patient name to the audit log (owner decision 7)', async () => {
      await post('/cases', baseCase({ patientName: 'Very Private Name' })).expect(201);
      const { rows } = await t.pool.query(`SELECT 1 FROM audit_log WHERE params::text ILIKE '%private%'`);
      expect(rows).toHaveLength(0);
    });
  });

  describe('editing', () => {
    let id: number;

    beforeAll(async () => {
      id = (
        await post(
          '/cases',
          baseCase({
            lines: [
              { toothNo: 11, workTypeId: w1 },
              { toothNo: 12, workTypeId: w2 },
            ],
          }),
        ).expect(201)
      ).body.id as number;
    });

    it('keeps snapshot prices after general and special prices change', async () => {
      const wt = (await get(`/work-types?search=Zirconia`).expect(200)).body.items[0] as {
        rowVersion: number;
      };
      await patch(`/work-types/${w1}`, { rowVersion: wt.rowVersion, unitPrice: 99999 }).expect(200);
      await request(t.http)
        .put(api(`/doctors/${d1}/prices/${w2}`))
        .set('Authorization', t.auth)
        .send({ price: 1 })
        .expect(200);
      const c = await detail(id);
      expect(c.lines.map((l) => l.unitPrice)).toEqual([20000, 12000]);

      const added = await post(`/cases/${id}/lines`, {
        rowVersion: c.rowVersion,
        lines: [
          { toothNo: 13, workTypeId: w1 },
          { toothNo: 14, workTypeId: w2 },
        ],
      }).expect(200);
      expect((added.body as Detail).lines.slice(-2).map((l) => [l.unitPrice, l.priceSource])).toEqual([
        [99999, 'general'],
        [1, 'special'],
      ]);
    });

    it('a manual price override is audited old → new', async () => {
      const c = await detail(id);
      const line = c.lines[0]!;
      const res = await patch(`/cases/${id}/lines/${line.id}`, {
        rowVersion: c.rowVersion,
        unitPrice: 18000,
      }).expect(200);
      expect((res.body as Detail).lines[0]).toMatchObject({ unitPrice: 18000, priceSource: 'manual' });
      const { rows } = await t.pool.query<{ params: Record<string, unknown> }>(
        `SELECT params FROM audit_log WHERE action = 'case.line_updated' ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0]?.params).toMatchObject({ unitPriceOld: 20000, unitPriceNew: 18000 });
    });

    it('discount cannot exceed the lines; removing a line cannot break that; the last line stays', async () => {
      let c = await detail(id);
      const tooBig = await patch(`/cases/${id}`, {
        rowVersion: c.rowVersion,
        discount: c.subtotal + 1,
      }).expect(409);
      expect(tooBig.body.error.code).toBe('error.case.discount_exceeds_subtotal');

      c = (await patch(`/cases/${id}`, { rowVersion: c.rowVersion, discount: c.subtotal - 1 }).expect(200))
        .body as Detail;
      expect(c.total).toBe(1);
      const blocked = await request(t.http)
        .delete(api(`/cases/${id}/lines/${c.lines[0]!.id}?rowVersion=${c.rowVersion}`))
        .set('Authorization', t.auth)
        .expect(409);
      expect(blocked.body.error.code).toBe('error.case.discount_exceeds_subtotal');

      c = (await patch(`/cases/${id}`, { rowVersion: c.rowVersion, discount: 0 }).expect(200)).body as Detail;
      for (const line of c.lines.slice(0, -1)) {
        c = (
          await request(t.http)
            .delete(api(`/cases/${id}/lines/${line.id}?rowVersion=${c.rowVersion}`))
            .set('Authorization', t.auth)
            .expect(200)
        ).body as Detail;
      }
      const last = await request(t.http)
        .delete(api(`/cases/${id}/lines/${c.lines[0]!.id}?rowVersion=${c.rowVersion}`))
        .set('Authorization', t.auth)
        .expect(409);
      expect(last.body.error.code).toBe('error.case.last_line');
    });

    it('rejects a stale rowVersion on every write and a doctor change', async () => {
      const c = await detail(id);
      const stale = c.rowVersion - 1;
      for (const res of [
        await patch(`/cases/${id}`, { rowVersion: stale, notes: 'x' }),
        await post(`/cases/${id}/lines`, { rowVersion: stale, lines: [{ toothNo: 15, workTypeId: w1 }] }),
        await patch(`/cases/${id}/lines/${c.lines[0]!.id}`, { rowVersion: stale, shade: 'B1' }),
        await post(`/cases/${id}/status`, { rowVersion: stale, to: 'ready' }),
        await post(`/cases/${id}/cancel`, { rowVersion: stale }),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('error.concurrency.stale');
      }
      await patch(`/cases/${id}`, { rowVersion: c.rowVersion, doctorId: d1 }).expect(400);
    });

    it('two concurrent edits of the same version → one 200, one 409', async () => {
      const c = await detail(id);
      const results = await Promise.all(
        ['n1', 'n2'].map((notes) => patch(`/cases/${id}`, { rowVersion: c.rowVersion, notes })),
      );
      expect(statusesOf(results)).toEqual([200, 409]);
    });
  });

  describe('total invariant (addition C)', () => {
    it('total = Σ line prices − discount after a randomized sequence of edits', async () => {
      // Deterministic PRNG so a failure is reproducible.
      let seed = 20261110;
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

      let c = (await post('/cases', baseCase({ lines: [{ toothNo: 31, workTypeId: w1 }] })).expect(201))
        .body as Detail;
      const id = c.id;
      const checkInvariant = async () => {
        const { rows } = await t.pool.query<{ total: string; discount: string; sum: string }>(
          `SELECT c.total, c.discount, COALESCE(SUM(i.unit_price), 0) AS sum
             FROM cases c LEFT JOIN case_items i ON i.case_id = c.id WHERE c.id = $1 GROUP BY c.id`,
          [id],
        );
        const r = rows[0]!;
        expect(Number(r.total)).toBe(Number(r.sum) - Number(r.discount));
        expect(c.total).toBe(Number(r.total));
      };

      for (let step = 0; step < 60; step++) {
        const op = pick(['add', 'add', 'price', 'delete', 'discount', 'discount_too_big']);
        let res;
        if (op === 'add') {
          const manual = rand() < 0.5 ? { unitPrice: Math.floor(rand() * 50000) } : {};
          res = await post(`/cases/${id}/lines`, {
            rowVersion: c.rowVersion,
            lines: [{ area: 'none', workTypeId: pick([w1, w2]), ...manual }],
          });
        } else if (op === 'price') {
          res = await patch(`/cases/${id}/lines/${pick(c.lines).id}`, {
            rowVersion: c.rowVersion,
            unitPrice: Math.floor(rand() * 50000),
          });
        } else if (op === 'delete') {
          res = await request(t.http)
            .delete(api(`/cases/${id}/lines/${pick(c.lines).id}?rowVersion=${c.rowVersion}`))
            .set('Authorization', t.auth);
        } else if (op === 'discount') {
          res = await patch(`/cases/${id}`, {
            rowVersion: c.rowVersion,
            discount: Math.floor(rand() * c.subtotal),
          });
        } else {
          res = await patch(`/cases/${id}`, { rowVersion: c.rowVersion, discount: c.subtotal + 1 });
          expect(res.status).toBe(409);
        }
        // Allowed refusals: last line, or a delete that would drop below the discount.
        expect([200, 409]).toContain(res.status);
        if (res.status === 200) c = res.body as Detail;
        else
          expect(['error.case.last_line', 'error.case.discount_exceeds_subtotal']).toContain(
            res.body.error.code,
          );
        await checkInvariant();
      }
    });
  });

  describe('status machine and delivery dates (addition A)', () => {
    let id: number;
    const move = async (to: string, extra: object = {}, status = 200) => {
      const c = await detail(id);
      return post(`/cases/${id}/status`, { rowVersion: c.rowVersion, to, ...extra }).expect(status);
    };

    beforeAll(async () => {
      id = (await post('/cases', baseCase({ receivedDate: '2026-11-05' })).expect(201)).body.id as number;
    });

    it('moves freely before delivery, refuses the same status', async () => {
      await move('waiting', {}, 200);
      await move('ready', {}, 200);
      expect((await move('ready', {}, 409)).body.error.code).toBe('error.case.same_status');
    });

    it('validates the delivery date: not before received, not after today, only with delivered', async () => {
      expect((await move('delivered', { deliveredDate: '2026-11-11' }, 400)).body.error.code).toBe(
        'error.case.delivered_date_invalid',
      );
      await move('delivered', { deliveredDate: '2026-11-04' }, 400);
      await move('in_progress', { deliveredDate: TODAY }, 400);
    });

    it('delivers with today by default; after delivery only "returned" is allowed', async () => {
      const res = await move('delivered', {}, 200);
      expect(res.body).toMatchObject({ status: 'delivered', deliveredDate: TODAY });
      const bad = await move('in_progress', {}, 409);
      expect(bad.body.error).toMatchObject({
        code: 'error.case.invalid_transition',
        params: { from: 'delivered', to: 'in_progress' },
      });
    });

    it('returned clears delivered_date; re-delivery keeps both dates in the history', async () => {
      const returned = await move('returned', { note: 'margin open' }, 200);
      expect(returned.body.deliveredDate).toBeNull();
      // From returned: only in_progress | ready | delivered.
      await move('waiting', {}, 409);
      await move('design', {}, 409);

      const redelivered = await move('delivered', { deliveredDate: '2026-11-09' }, 200);
      expect(redelivered.body.deliveredDate).toBe('2026-11-09');
      const deliveries = (redelivered.body as Detail).history
        .filter((h) => h.toStatus === 'delivered')
        .map((h) => h.deliveredDate);
      expect(deliveries).toEqual([TODAY, '2026-11-09']);
    });
  });

  describe('cancel (final)', () => {
    it('cancels before delivery, then refuses every change', async () => {
      const c = (await post('/cases', baseCase()).expect(201)).body as Detail;
      const cancelled = await post(`/cases/${c.id}/cancel`, {
        rowVersion: c.rowVersion,
        reason: 'doctor called',
      }).expect(200);
      expect(cancelled.body.status).toBe('cancelled');
      expect(cancelled.body).toMatchObject({ allowedStatuses: [], canCancel: false, canEdit: false });
      expect(cancelled.body.history.at(-1)).toMatchObject({
        fromStatus: 'design',
        toStatus: 'cancelled',
        note: 'doctor called',
      });
      const v = cancelled.body.rowVersion as number;
      for (const res of [
        await patch(`/cases/${c.id}`, { rowVersion: v, notes: 'x' }),
        await post(`/cases/${c.id}/status`, { rowVersion: v, to: 'design' }),
        await post(`/cases/${c.id}/cancel`, { rowVersion: v }),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('error.case.cancelled');
      }
    });

    it('cannot cancel after delivery or from returned (B2)', async () => {
      let c = (await post('/cases', baseCase()).expect(201)).body as Detail;
      c = (await post(`/cases/${c.id}/status`, { rowVersion: c.rowVersion, to: 'delivered' }).expect(200))
        .body as Detail;
      expect(c).toMatchObject({ allowedStatuses: ['returned'], canCancel: false, canEdit: true });
      const fromDelivered = await post(`/cases/${c.id}/cancel`, { rowVersion: c.rowVersion }).expect(409);
      expect(fromDelivered.body.error).toMatchObject({
        code: 'error.case.cannot_cancel',
        params: { status: 'delivered' },
      });
      c = (await post(`/cases/${c.id}/status`, { rowVersion: c.rowVersion, to: 'returned' }).expect(200))
        .body as Detail;
      expect(c).toMatchObject({ allowedStatuses: ['in_progress', 'ready', 'delivered'], canCancel: false });
      await post(`/cases/${c.id}/cancel`, { rowVersion: c.rowVersion }).expect(409);
    });
  });

  describe('overdue at the lab’s midnight (addition D)', () => {
    let id: number;

    beforeAll(async () => {
      id = (await post('/cases', baseCase({ patientName: 'Midnight', expectedDate: TODAY })).expect(201)).body
        .id as number;
    });

    afterAll(() => clock.set(NOON));

    const listed = async () => {
      const res = await get(`/cases?overdue=true&search=Midnight`).expect(200);
      return (res.body.items as { id: number; overdue: boolean }[]).some((c) => c.id === id);
    };

    it('23:59:59 Hebron: not overdue in the detail and not in the overdue list', async () => {
      clock.set('2026-11-10T21:59:59Z');
      expect((await detail(id)).overdue).toBe(false);
      expect(await listed()).toBe(false);
    });

    it('00:00:00 Hebron (UTC still on the 10th): overdue in both', async () => {
      clock.set('2026-11-10T22:00:00Z');
      expect((await detail(id)).overdue).toBe(true);
      expect(await listed()).toBe(true);
      const all = await get(`/cases?search=Midnight`).expect(200);
      expect(all.body.items[0].overdue).toBe(true);
    });
  });

  describe('list filters', () => {
    it('filters by status, doctor, received range; searches patient or exact case number', async () => {
      const d2 = (await post('/doctors', { name: 'Dr Two' }).expect(201)).body.id as number;
      const own = (
        await post(
          '/cases',
          baseCase({ doctorId: d2, patientName: 'Omar Haddad', receivedDate: '2026-11-01' }),
        ).expect(201)
      ).body as Detail;

      const byDoctor = await get(`/cases?doctorId=${d2}`).expect(200);
      expect(byDoctor.body.total).toBe(1);
      const byName = await get(`/cases?search=haddad`).expect(200);
      expect(byName.body.items.map((c: { id: number }) => c.id)).toEqual([own.id]);
      const byNo = await get(`/cases?search=${own.caseNo}`).expect(200);
      expect(byNo.body.items.map((c: { id: number }) => c.id)).toContain(own.id);
      const range = await get(`/cases?from=2026-11-01&to=2026-11-01`).expect(200);
      expect(range.body.items.every((c: { receivedDate: string }) => c.receivedDate === '2026-11-01')).toBe(
        true,
      );
      const cancelled = await get(`/cases?status=cancelled`).expect(200);
      expect(cancelled.body.items.every((c: { status: string }) => c.status === 'cancelled')).toBe(true);
      await get('/cases?status=invoiced').expect(400);
      await get('/cases?from=2026-13-01').expect(400);
    });
  });

  describe('delete-or-deactivate now meets real foreign keys (B1 rule)', () => {
    it('a doctor, technician or work type used by a case is deactivated, not deleted', async () => {
      const d = (await post('/doctors', { name: 'Dr Used' }).expect(201)).body.id as number;
      const tc = (await post('/technicians', { name: 'Tech Used' }).expect(201)).body.id as number;
      const w = (await post('/work-types', { name: 'Used type', unitPrice: 10 }).expect(201)).body
        .id as number;
      await post(
        '/cases',
        baseCase({ doctorId: d, technicianId: tc, lines: [{ toothNo: 11, workTypeId: w }] }),
      ).expect(201);
      for (const path of [`/doctors/${d}`, `/technicians/${tc}`, `/work-types/${w}`]) {
        const res = await request(t.http).delete(api(path)).set('Authorization', t.auth).expect(200);
        expect(res.body).toEqual({ outcome: 'deactivated' });
      }
    });
  });
});
