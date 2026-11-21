import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, startTestApp, TestApp } from '../support/app';

jest.setTimeout(300_000);

/** 2026-11-20 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-20T10:00:00Z';

const PNG_A = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const PNG_B = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80, 9)]);

interface InvoiceBody {
  id: number;
  no: number;
  type: string;
  status: string;
  total: number | null;
  snapshotSha256: string;
  snapshot: Record<string, unknown> & { lab: { logo: { sha256: string } | null } };
  rowVersion: number;
}

/**
 * B6 acceptance (SPEC §11: "snapshot never changes after later edits"; plan §8). One invoice of each type is
 * issued, then everything it was built from is changed — the doctor, the work type and its prices, the special
 * price, the lab profile, the logo (replaced, then removed), the appearance, the currency symbol, the document
 * language, the case's status and collect date, payments (added, voided, a cheque bounced) — and finally the
 * cases invoice is voided and its case edited. Every issued snapshot, its hash, number, totals and frozen logo
 * must be byte-identical afterwards, and the database itself must refuse a direct change.
 */
describe('Invoice snapshots are immutable (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string) => request(t.http).get(api(p)).set('Authorization', t.auth);
  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const patch = (p: string, body: object) => request(t.http).patch(api(p)).set('Authorization', t.auth).send(body);
  const put = (p: string, body: object) => request(t.http).put(api(p)).set('Authorization', t.auth).send(body);
  type Versioned = { rowVersion: number };
  const settings = async () =>
    (await get('/settings').expect(200)).body as { labProfile: Versioned; currency: Versioned; language: Versioned };
  const uploadLogo = (data: Buffer) =>
    request(t.http)
      .put(api('/settings/logo'))
      .set('Authorization', t.auth)
      .attach('file', data, { filename: 'logo.png', contentType: 'image/png' })
      .expect(200);

  let doctorId: number;
  let workTypeId: number;
  let caseId: number;
  let payId: number;
  let chequeId: number;

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await settings();
    await patch('/settings/lab-profile', {
      rowVersion: s.labProfile.rowVersion,
      timeZone: 'Asia/Hebron',
      nameEn: 'Test Lab',
      address: 'Old address',
      slogan: 'Old slogan',
    }).expect(200);
    await uploadLogo(PNG_A);
    workTypeId = (await post('/work-types', { name: 'Zirconia crown', unitPrice: 30_000 }).expect(201)).body.id as number;
    doctorId = (await post('/doctors', { name: 'Dr Frozen', clinic: 'Old clinic', phone: '0599000000' }).expect(201)).body
      .id as number;
    const c = await post('/cases', {
      doctorId,
      patientName: 'Patient Frozen',
      receivedDate: '2026-11-02',
      expectedDate: '2026-11-25',
      status: 'ready',
      discount: 2_000,
      lines: [
        { toothNo: 11, workTypeId, shade: 'A2' },
        { toothNo: 21, workTypeId, shade: 'A2' },
      ],
    }).expect(201);
    caseId = c.body.id as number;
    const pay = await post('/payments', { doctorId, method: 'cash', amount: 10_000 }, randomUUID()).expect(201);
    payId = pay.body.payment.id as number;
    const ch = await post(
      '/payments',
      { doctorId, method: 'cheque', amount: 5_000, cheque: { chequeNo: 'FZ-1', bank: 'Frozen Bank', dueDate: '2026-11-25' } },
      randomUUID(),
    ).expect(201);
    chequeId = ch.body.payment.cheque.id as number;
    await patch(`/cheques/${chequeId}/status`, { status: 'cleared', rowVersion: ch.body.payment.cheque.rowVersion }).expect(200);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('a snapshot never changes after later edits (all three types, logo bytes included)', async () => {
    const issued: InvoiceBody[] = [];
    issued.push(
      (
        await post('/invoices', { type: 'cases', doctorId, caseIds: [caseId], expectedTotal: 58_000, notes: 'Thanks' }, randomUUID()).expect(
          201,
        )
      ).body as InvoiceBody,
    );
    issued.push((await post('/invoices', { type: 'statement', doctorId }, randomUUID()).expect(201)).body as InvoiceBody);
    issued.push(
      (await post('/invoices', { type: 'free', doctorId, reason: 'Delivery fee', amount: 2_500 }, randomUUID()).expect(201))
        .body as InvoiceBody,
    );
    expect(issued.map((i) => i.type)).toEqual(['cases', 'statement', 'free']);
    expect(issued[0]).toMatchObject({ total: 58_000, status: 'active' });

    const before = await Promise.all(issued.map(async (i) => (await get(`/invoices/${i.id}`).expect(200)).text));
    const logoBefore = (await get(`/invoices/${issued[0]!.id}/logo`).buffer(true).expect(200)).body as Buffer;
    expect(createHash('sha256').update(logoBefore).digest('hex')).toBe(issued[0]!.snapshot.lab.logo?.sha256);

    // ---- change everything the invoices were built from ----
    const doc = (await get(`/doctors/${doctorId}`).expect(200)).body;
    await patch(`/doctors/${doctorId}`, { rowVersion: doc.rowVersion, name: 'Dr Renamed', clinic: 'New clinic', phone: '0599111111' }).expect(
      200,
    );
    const wt = (await get(`/work-types?pageSize=100`).expect(200)).body.items.find((w: { id: number }) => w.id === workTypeId);
    await patch(`/work-types/${workTypeId}`, { rowVersion: wt.rowVersion, name: 'Renamed crown', unitPrice: 99_000 }).expect(200);
    await put(`/doctors/${doctorId}/prices/${workTypeId}`, { price: 12_345 }).expect(200);
    let s = await settings();
    await patch('/settings/lab-profile', {
      rowVersion: s.labProfile.rowVersion,
      nameAr: 'مختبر جديد',
      nameEn: 'New Lab',
      phone: '02 999 9999',
      address: 'New address',
      slogan: 'New slogan',
    }).expect(200);
    await uploadLogo(PNG_B);
    s = await settings();
    await patch('/settings/currency', { rowVersion: s.currency.rowVersion, symbol: 'NIS' }).expect(200);
    s = await settings();
    await patch('/settings/language', { rowVersion: s.language.rowVersion, documents: 'en' }).expect(200);
    const tpl = (await get('/settings/invoice-template').expect(200)).body;
    await put('/settings/invoice-template', {
      rowVersion: tpl.rowVersion,
      template: { ...tpl.template, primaryColor: '#123456', columns: ['caseNo', 'lineTotal'], footerText: 'New footer', showBalances: false },
    }).expect(200);
    // Case status and collect date (allowed while invoiced).
    let c = (await get(`/cases/${caseId}`).expect(200)).body;
    c = (await post(`/cases/${caseId}/delivery`, { rowVersion: c.rowVersion, received: 'none', collectOn: '2026-11-28' }).expect(200)).body
      .case;
    c = (await post(`/cases/${caseId}/status`, { rowVersion: c.rowVersion, to: 'returned' }).expect(200)).body;
    await post(`/cases/${caseId}/delivery`, { rowVersion: c.rowVersion, received: 'none', collectOn: '2026-11-29' }).expect(200);
    // Money moves: a new payment, a void, a bounced cheque.
    await post('/payments', { doctorId, caseId, method: 'cash', amount: 7_000 }, randomUUID()).expect(201);
    const p = (await get(`/payments/${payId}`).expect(200)).body as { rowVersion: number };
    await post(`/payments/${payId}/void`, { rowVersion: p.rowVersion, reason: 'entered twice' }).expect(200);
    const ch = (await get(`/payments`).query({ doctorId, method: 'cheque' }).expect(200)).body.items[0].cheque;
    await patch(`/cheques/${chequeId}/status`, { status: 'returned', rowVersion: ch.rowVersion }).expect(200);
    // Void the cases invoice, then edit the case it covered.
    const inv = (await get(`/invoices/${issued[0]!.id}`).expect(200)).body as InvoiceBody;
    await post(`/invoices/${inv.id}/void`, { rowVersion: inv.rowVersion, reason: 'wrong cases' }).expect(200);
    c = (await get(`/cases/${caseId}`).expect(200)).body;
    c = (await patch(`/cases/${caseId}`, { rowVersion: c.rowVersion, patientName: 'Patient Renamed', discount: 0 }).expect(200)).body;
    await patch(`/cases/${caseId}/lines/${c.lines[0].id}`, { rowVersion: c.rowVersion, unitPrice: 1_000, shade: 'B3' }).expect(200);
    // Finally remove the logo altogether.
    await request(t.http).delete(api('/settings/logo')).set('Authorization', t.auth).expect(204);

    // ---- every issued snapshot is unchanged ----
    const after = await Promise.all(issued.map(async (i) => (await get(`/invoices/${i.id}`).expect(200)).body as InvoiceBody));
    for (const [i, a] of after.entries()) {
      const b = JSON.parse(before[i]!) as InvoiceBody;
      expect(a.snapshot).toEqual(b.snapshot);
      expect(a.snapshotSha256).toBe(b.snapshotSha256);
      expect(a.no).toBe(b.no);
      expect(a.total).toBe(b.total);
    }
    expect(after[0]!.status).toBe('void');
    expect(JSON.stringify(after[0]!.snapshot)).toContain('Patient Frozen');
    expect(JSON.stringify(after[0]!.snapshot)).toContain('Zirconia crown');
    expect(JSON.stringify(after[0]!.snapshot)).not.toContain('Renamed');
    expect(after[1]!.snapshot).toMatchObject({ party: { name: 'Dr Frozen', clinic: 'Old clinic' } });
    expect(after[2]!.snapshot).toMatchObject({ lab: { nameEn: 'Test Lab', address: 'Old address', slogan: 'Old slogan' } });
    expect(after[0]!.snapshot).toMatchObject({ currency: { symbol: '₪' }, language: 'ar', layout: { footerText: '', showBalances: true } });
    const logoAfter = (await get(`/invoices/${issued[0]!.id}/logo`).buffer(true).expect(200)).body as Buffer;
    expect(logoAfter.equals(logoBefore)).toBe(true);
  });

  it('the database refuses any change to issued content, and any delete', async () => {
    const inv = (await post('/invoices', { type: 'free', partyName: 'Walk-in', reason: 'Repair', amount: 1_000 }, randomUUID()).expect(201))
      .body as InvoiceBody;
    const attempts = [
      `UPDATE invoices SET snapshot = '{}'::jsonb WHERE id = ${inv.id}`,
      `UPDATE invoices SET total = total + 1, subtotal = subtotal + 1 WHERE id = ${inv.id}`,
      `UPDATE invoices SET no = no + 1000 WHERE id = ${inv.id}`,
      `UPDATE invoices SET snapshot_sha256 = 'x' WHERE id = ${inv.id}`,
      `UPDATE invoices SET issue_date = '2026-01-01' WHERE id = ${inv.id}`,
      `DELETE FROM invoices WHERE id = ${inv.id}`,
      `DELETE FROM invoice_cases`,
      `DELETE FROM document_images`,
      `UPDATE document_images SET content = '\\x00'::bytea`,
    ];
    for (const sql of attempts) {
      await expect(t.pool.query(sql)).rejects.toThrow(/immutable/);
    }
    // Void is one way.
    await post(`/invoices/${inv.id}/void`, { rowVersion: inv.rowVersion, reason: 'test' }).expect(200);
    await expect(t.pool.query(`UPDATE invoices SET status = 'active', void_reason = NULL, voided_at = NULL, voided_by = NULL WHERE id = ${inv.id}`)).rejects.toThrow(
      /immutable/,
    );
    const again = (await get(`/invoices/${inv.id}`).expect(200)).body as InvoiceBody;
    expect(again.snapshotSha256).toBe(inv.snapshotSha256);
  });
});
