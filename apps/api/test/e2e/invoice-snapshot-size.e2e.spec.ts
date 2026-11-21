import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';

jest.setTimeout(600_000);

/** 2026-11-20 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-20T10:00:00Z';

/**
 * B6b stage-0 item left open in B6: how big is a snapshot at the plan's caps (200 cases per invoice, 2 000
 * statement lines)? The data is generated here (cases through the API with three teeth each and Arabic names;
 * the statement's 1 000 cases and 1 000 payments through SQL), the invoices are issued and read, and the sizes
 * and timings are printed for `docs/production-readiness.md` (input for B8). The assertions are the design
 * limits: a snapshot under the 1 MB cap of the plan, and the stored size equal to the sizes the API returns.
 */
describe('Invoice snapshot size at the caps (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string) => request(t.http).get(api(p)).set('Authorization', t.auth);
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const report: string[] = [];

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await request(t.http)
      .patch(api('/settings/lab-profile'))
      .set('Authorization', t.auth)
      .send({ rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron', address: 'الخليل - شارع عين سارة', slogan: 'دقة وجودة' })
      .expect(200);
  });
  afterAll(async () => {
    process.stdout.write(`\nSNAPSHOT-SIZE\n${report.join('\n')}\n`);
    await t?.close();
  });

  const bytes = (v: unknown) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');

  it('a cases invoice with 200 cases of 3 lines each', async () => {
    const wt = (await post('/work-types', { name: 'تاج زيركون كامل', unitPrice: 25_000 }).expect(201)).body.id as number;
    const doctorId = (await post('/doctors', { name: 'د. أحمد سالم العبد الله', clinic: 'عيادة الابتسامة للأسنان', phone: '0599123456' }).expect(201)).body.id as number;
    const ids: number[] = [];
    for (let i = 0; i < 200; i += 10) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, async (_, k) =>
          (
            await post('/cases', {
              doctorId,
              patientName: `المريض رقم ${i + k + 1} محمد عبد الرحمن`,
              receivedDate: '2026-11-01',
              expectedDate: '2026-11-30',
              status: 'ready',
              lines: [11, 12, 13].map((toothNo) => ({ toothNo, workTypeId: wt, shade: 'A2', unitPrice: 25_000 })),
            }).expect(201)
          ).body.id as number,
        ),
      );
      ids.push(...batch);
    }
    const started = Date.now();
    const res = await post('/invoices', { type: 'cases', doctorId, caseIds: ids, expectedTotal: 200 * 3 * 25_000, notes: 'ملاحظات الفاتورة' }, randomUUID()).expect(201);
    const issueMs = Date.now() - started;
    const stored = await t.pool.query<{ json: number; db: number; text_len: number }>(
      `SELECT octet_length(snapshot::text) AS json, pg_column_size(snapshot) AS db, length(snapshot::text) AS text_len FROM invoices WHERE id = $1`,
      [res.body.id],
    );
    const readStarted = Date.now();
    const read = await get(`/invoices/${res.body.id}`).expect(200);
    const readMs = Date.now() - readStarted;
    const row = stored.rows[0]!;
    report.push(
      `cases invoice, 200 cases / 600 case lines → 200 grouped lines: snapshot ${row.json} bytes as text (${row.db} bytes stored, compressed jsonb), ` +
        `response ${bytes(read.text)} bytes, issue ${issueMs} ms, GET ${readMs} ms`,
    );
    expect(row.json).toBeLessThan(1_000_000);
    expect(bytes(read.body.snapshot)).toBeLessThan(1_000_000);
    expect(read.body.snapshot.cases).toHaveLength(200);
  });

  it('a statement of 2 000 lines (1 000 cases + 1 000 payments)', async () => {
    const doctorId = (await post('/doctors', { name: 'د. كشف طويل' }).expect(201)).body.id as number;
    await t.pool.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, status, discount, total, created_by, updated_by)
       SELECT 800000 + g, $1, 'المريض ' || g || ' محمد عبد الرحمن', date '2026-01-01' + (g % 300), date '2026-01-08' + (g % 300), 'ready', 0, 20000, 1, 1
       FROM generate_series(1, 1000) g`,
      [doctorId],
    );
    await t.pool.query(
      `INSERT INTO payments (voucher_no, doctor_id, method, amount, currency_code, paid_at, created_by, updated_by)
       SELECT 800000 + g, $1, 'cash', 5000, 'ILS', date '2026-01-02' + (g % 300), 1, 1 FROM generate_series(1, 1000) g`,
      [doctorId],
    );
    const started = Date.now();
    const res = await post('/invoices', { type: 'statement', doctorId }, randomUUID());
    expect([res.status, res.body.error?.code]).toEqual([201, undefined]);
    const issueMs = Date.now() - started;
    const stored = await t.pool.query<{ json: number; db: number }>(
      `SELECT octet_length(snapshot::text) AS json, pg_column_size(snapshot) AS db FROM invoices WHERE id = $1`,
      [res.body.id],
    );
    const readStarted = Date.now();
    const read = await get(`/invoices/${res.body.id}`).expect(200);
    const readMs = Date.now() - readStarted;
    const row = stored.rows[0]!;
    report.push(
      `statement, 2 000 lines: snapshot ${row.json} bytes as text (${row.db} bytes stored), response ${bytes(read.text)} bytes, issue ${issueMs} ms, GET ${readMs} ms`,
    );
    expect(read.body.snapshot.statement.lines).toHaveLength(2000);
    expect(row.json).toBeLessThan(1_000_000);
  });
});
