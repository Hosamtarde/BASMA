import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';

jest.setTimeout(300_000);

const NOON = '2026-11-20T10:00:00Z';

interface Line {
  date: string;
  kind: string;
  ref: string;
  debit: number;
  credit: number;
  running: number;
}

/**
 * B6b, found while measuring a 2 000-line statement: the statement lists same-day items of the same kind in
 * id order, and the running balance must follow the list. The SQL ordered the page by the TEXT alias of the id
 * («10» before «9»), while the running balance was summed in numeric id order, so a doctor with several cases
 * received on one day whose ids cross a power of ten (9 → 10, 99 → 100) saw a running balance that did not add
 * up line by line — and issuing that statement as an invoice failed its own consistency check (500).
 */
describe('Statement order of same-day items (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string) => request(t.http).get(api(p)).set('Authorization', t.auth);
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  let doctorId: number;

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await request(t.http)
      .patch(api('/settings/lab-profile'))
      .set('Authorization', t.auth)
      .send({ rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' })
      .expect(200);
    const wt = (await post('/work-types', { name: 'Crown', unitPrice: 10_000 }).expect(201)).body.id as number;
    doctorId = (await post('/doctors', { name: 'Dr Order', openingBalance: 5_000 }).expect(201)).body.id as number;
    // 12 cases on one day (ids 1..12 cross 9 → 10) with different prices, then 12 payments on the same day.
    for (let i = 1; i <= 12; i += 1) {
      await post('/cases', {
        doctorId,
        patientName: `P${i}`,
        receivedDate: '2026-11-05',
        expectedDate: '2026-11-30',
        lines: [{ toothNo: 11, workTypeId: wt, unitPrice: i * 1_000 }],
      }).expect(201);
    }
    for (let i = 1; i <= 12; i += 1) {
      await post('/payments', { doctorId, method: 'cash', amount: i * 100, paidAt: '2026-11-05' }, randomUUID()).expect(201);
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  it('every line of the statement adds up to the next, and same-day items follow id order', async () => {
    const st = (await get(`/doctors/${doctorId}/statement?pageSize=100`).expect(200)).body as { lines: Line[]; opening: number; closing: number };
    expect(st.lines).toHaveLength(24);
    let running = st.opening;
    for (const l of st.lines) {
      running += l.debit - l.credit;
      expect({ ref: l.ref, running: l.running }).toEqual({ ref: l.ref, running });
    }
    expect(running).toBe(st.closing);
    const cases = st.lines.filter((l) => l.kind === 'case').map((l) => l.debit);
    expect(cases).toEqual(Array.from({ length: 12 }, (_, i) => (i + 1) * 1_000));
    const payments = st.lines.filter((l) => l.kind === 'payment').map((l) => l.credit);
    expect(payments).toEqual(Array.from({ length: 12 }, (_, i) => (i + 1) * 100));
  });

  it('the same statement can be issued as an invoice', async () => {
    const res = await post('/invoices', { type: 'statement', doctorId }, randomUUID());
    expect(res.status).toBe(201);
    expect(res.body.snapshot.statement.lines).toHaveLength(24);
  });
});
