import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeClock, HttpMethod, requestFor, startTestApp, statusesOf, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

/** 2026-11-20 12:00 in Hebron (UTC+2 in November). */
const NOON = '2026-11-20T10:00:00Z';

interface Snapshot {
  no: number;
  type: string;
  totals?: { subtotal: number; discount: number; total: number };
  balances?: { previous: number; current: number; pendingCheques: number };
  cases?: { caseNo: number; paid: number; remaining: number; total: number; discount: number }[];
  lines?: { caseNo: number; qty: number; teeth: number[]; lineTotal: number; unitPrice: number }[];
  statement?: { closing: number; periodOpening: number; lines: unknown[] };
  party: { kind: string; name: string };
}
interface Invoice {
  id: number;
  no: number;
  type: string;
  status: string;
  total: number | null;
  subtotal: number | null;
  discount: number | null;
  rowVersion: number;
  voidReason: string | null;
  snapshot: Snapshot;
}
interface CaseBody {
  id: number;
  caseNo: number;
  rowVersion: number;
  status: string;
  total: number;
  canEdit: boolean;
  canCancel: boolean;
  editBlockedReason: string | null;
  invoice: { id: number; no: number } | null;
  lines: { id: number }[];
}

/**
 * B6 invoices (SPEC §5.14; docs/plans/b6-invoices.md §3, §4, §7, §8). Worked examples W1–W6 with exact
 * integers, every new error code in Arabic and English, S13 (no edit / cancel of an invoiced case), the
 * permissions of every route, the appearance endpoints (including injection attempts) and the CSV.
 */
describe('Invoices (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string, auth?: string) => request(t.http).get(api(p)).set('Authorization', auth ?? t.auth);
  const post = (p: string, body: object, key?: string, auth?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', auth ?? t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const patch = (p: string, body: object) => request(t.http).patch(api(p)).set('Authorization', t.auth).send(body);
  const put = (p: string, body: object, auth?: string) => request(t.http).put(api(p)).set('Authorization', auth ?? t.auth).send(body);
  const issue = (body: object, key: string = randomUUID(), auth?: string) => post('/invoices', body, key, auth);
  const issued = async (body: object) => (await issue(body).expect(201)).body as Invoice;
  const voidIt = (inv: { id: number; rowVersion: number }, reason = 'خطأ في اختيار الحالات') =>
    post(`/invoices/${inv.id}/void`, { rowVersion: inv.rowVersion, reason });
  const balance = async (doctorId: number) => ((await get(`/doctors/${doctorId}/balance`).expect(200)).body as { balance: number }).balance;
  const caseOf = async (id: number) => (await get(`/cases/${id}`).expect(200)).body as CaseBody;

  let workType: number;
  let seq = 0;
  const doctor = async (openingBalance = 0) =>
    (await post('/doctors', { name: `Dr Invoice ${++seq}-${randomUUID().slice(0, 6)}`, openingBalance }).expect(201)).body.id as number;
  const newCase = async (doctorId: number, prices: number[], o: { receivedDate?: string; status?: string; discount?: number } = {}) =>
    (
      await post('/cases', {
        doctorId,
        patientName: `Patient ${++seq}`,
        receivedDate: o.receivedDate ?? '2026-11-01',
        expectedDate: '2026-11-30',
        status: o.status ?? 'ready',
        discount: o.discount ?? 0,
        lines: prices.map((unitPrice, i) => ({ toothNo: 11 + i, workTypeId: workType, unitPrice, shade: 'A2' })),
      }).expect(201)
    ).body as CaseBody;
  const pay = (body: object) => post('/payments', body, randomUUID()).expect(201);

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await get('/settings').expect(200);
    await patch('/settings/lab-profile', { rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' }).expect(200);
    await patch('/settings/numbering', { invoiceNoStart: 1001 }).expect(200);
    workType = (await post('/work-types', { name: 'Invoice crown', unitPrice: 10_000 }).expect(201)).body.id as number;
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('authorization', () => {
    const routes: [HttpMethod, string][] = [
      ['get', '/invoices'],
      ['get', '/invoices/summary'],
      ['get', '/invoices/eligible-cases?doctorId=1'],
      ['post', '/invoices'],
      ['post', '/invoices/preview'],
      ['get', '/invoices/1'],
      ['get', '/invoices/1/logo'],
      ['post', '/invoices/1/void'],
      ['get', '/settings/invoice-template'],
      ['put', '/settings/invoice-template'],
      ['get', '/exports/invoices'],
    ];
    it.each(routes)('%s %s → 401 without a token, 403 without permissions', async (method, path) => {
      await requestFor(t.http, method, api(path)).expect(401);
      await requestFor(t.http, method, api(path)).set('Authorization', t.limitedAuth).expect(403);
    });

    it('issuing needs invoices.write; a cases invoice also cases.read + ledger.read; a statement ledger.read; void needs invoices.void', async () => {
      const d = await doctor();
      const c = await newCase(d, [10_000]);
      const readOnly = await tokenWith(t, ['invoices.read']);
      await issue({ type: 'free', partyName: 'X', reason: 'r', amount: 100 }, randomUUID(), readOnly).expect(403);
      const writeOnly = await tokenWith(t, ['invoices.write']);
      await issue({ type: 'cases', doctorId: d, caseIds: [c.id], expectedTotal: 10_000 }, randomUUID(), writeOnly).expect(403);
      await issue({ type: 'statement', doctorId: d }, randomUUID(), writeOnly).expect(403);
      const free = await issue({ type: 'free', partyName: 'X', reason: 'r', amount: 100 }, randomUUID(), writeOnly).expect(201);
      await post(`/invoices/${free.body.id}/void`, { rowVersion: free.body.rowVersion, reason: 'x' }, undefined, writeOnly).expect(403);
      const full = await tokenWith(t, ['invoices.write', 'cases.read', 'ledger.read']);
      await issue({ type: 'cases', doctorId: d, caseIds: [c.id], expectedTotal: 10_000 }, randomUUID(), full).expect(201);
      // The appearance: read with settings.read, save with settings.write.
      await put('/settings/invoice-template', { rowVersion: 0, template: {} }, await tokenWith(t, ['settings.read'])).expect(403);
      // CSV: invoices.read AND exports.run.
      await get('/exports/invoices', readOnly).expect(403);
      await get('/exports/invoices', await tokenWith(t, ['invoices.read', 'exports.run'])).expect(200);
    });
  });

  describe('worked examples (plan §3.3, minor units)', () => {
    let e: number;
    let c201: CaseBody;
    let c202: CaseBody;
    let c203: CaseBody;
    let transferId: number;
    let transferVersion: number;

    beforeAll(async () => {
      e = await doctor(10_000);
      c201 = await newCase(e, [30_000], { receivedDate: '2026-11-01' });
      c202 = await newCase(e, [20_000], { receivedDate: '2026-11-02' });
      c203 = await newCase(e, [15_000], { receivedDate: '2026-11-04' });
      await pay({ doctorId: e, caseId: c202.id, method: 'cash', amount: 12_000, paidAt: '2026-11-05' });
      await pay({ doctorId: e, method: 'cash', amount: 25_000, paidAt: '2026-11-06' });
      const tr = await pay({ doctorId: e, caseId: c203.id, method: 'transfer', amount: 6_000, paidAt: '2026-11-07' });
      transferId = tr.body.payment.id as number;
      transferVersion = tr.body.payment.rowVersion as number;
      // #201 is delivered (nothing taken, a collect date), #202 and #203 stay ready.
      const cur = await caseOf(c201.id);
      await post(`/cases/${c201.id}/delivery`, { rowVersion: cur.rowVersion, received: 'none', collectOn: '2026-11-30' }).expect(200);
    });

    let w1: Invoice;
    it('W1 — a cases invoice: 500.00, current 320.00, previous −180.00; the ledger does not move', async () => {
      expect(await balance(e)).toBe(32_000);
      const eligible = (await get(`/invoices/eligible-cases?doctorId=${e}`).expect(200)).body as { items: { caseNo: number; paid: number; remaining: number }[] };
      expect(eligible.items.map((i) => [i.caseNo, i.paid, i.remaining])).toEqual([
        [c201.caseNo, 15_000, 15_000],
        [c202.caseNo, 12_000, 8_000],
        [c203.caseNo, 6_000, 9_000],
      ]);
      const preview = (await post('/invoices/preview', { type: 'cases', doctorId: e, caseIds: [c202.id, c201.id] }).expect(200)).body
        .snapshot as Snapshot;
      expect(preview).toMatchObject({ no: 0, totals: { subtotal: 50_000, discount: 0, total: 50_000 } });
      w1 = await issued({ type: 'cases', doctorId: e, caseIds: [c202.id, c201.id], expectedTotal: 50_000, notes: 'شكرًا' });
      expect(w1.no).toBeGreaterThanOrEqual(1001);
      expect(w1).toMatchObject({ type: 'cases', status: 'active', subtotal: 50_000, discount: 0, total: 50_000 });
      expect(w1.snapshot.balances).toEqual({ previous: -18_000, current: 32_000, pendingCheques: 0 });
      expect(w1.snapshot.cases?.map((c) => [c.caseNo, c.paid, c.remaining])).toEqual([
        [c201.caseNo, 15_000, 15_000],
        [c202.caseNo, 12_000, 8_000],
      ]);
      expect(w1.snapshot.lines?.map((l) => [l.caseNo, l.qty, l.lineTotal])).toEqual([
        [c201.caseNo, 1, 30_000],
        [c202.caseNo, 1, 20_000],
      ]);
      expect(await balance(e)).toBe(32_000);
      const st = (await get(`/doctors/${e}/statement?pageSize=100`).expect(200)).body as { closing: number };
      expect(st.closing).toBe(32_000);
      // Only #203 is left to invoice.
      const after = (await get(`/invoices/eligible-cases?doctorId=${e}`).expect(200)).body as { items: { caseNo: number }[] };
      expect(after.items.map((i) => i.caseNo)).toEqual([c203.caseNo]);
      expect((await caseOf(c201.id)).invoice).toEqual({ id: w1.id, no: w1.no });
    });

    it('S13 — an invoiced case can be neither edited nor cancelled (also from «مرتجعة»); status moves stay allowed', async () => {
      let c = await caseOf(c202.id);
      expect(c).toMatchObject({ canEdit: false, canCancel: false, editBlockedReason: 'invoiced' });
      const refusals = [
        patch(`/cases/${c.id}`, { rowVersion: c.rowVersion, notes: 'x' }),
        post(`/cases/${c.id}/lines`, { rowVersion: c.rowVersion, lines: [{ toothNo: 21, workTypeId: workType }] }),
        patch(`/cases/${c.id}/lines/${c.lines[0]!.id}`, { rowVersion: c.rowVersion, unitPrice: 1 }),
        request(t.http).delete(api(`/cases/${c.id}/lines/${c.lines[0]!.id}?rowVersion=${c.rowVersion}`)).set('Authorization', t.auth),
        post(`/cases/${c.id}/cancel`, { rowVersion: c.rowVersion }),
      ];
      for (const r of await Promise.all(refusals)) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('error.case.invoiced');
        expect(r.body.error.params).toMatchObject({ caseNo: c.caseNo, invoiceNo: w1.no });
      }
      // Delivered → returned is allowed (SPEC §9) — and cancelling from «مرتجعة» is still refused while invoiced.
      let d = await caseOf(c201.id);
      d = (await post(`/cases/${d.id}/status`, { rowVersion: d.rowVersion, to: 'returned' }).expect(200)).body as CaseBody;
      const cancel = await post(`/cases/${d.id}/cancel`, { rowVersion: d.rowVersion, reason: 'لن يستلمها' })
        .set('Accept-Language', 'en')
        .expect(409);
      expect(cancel.body.error).toMatchObject({ code: 'error.case.invoiced' });
      expect(cancel.body.error.message).toContain('void the invoice first');
      // Re-deliver (allowed while invoiced).
      d = await caseOf(d.id);
      await post(`/cases/${d.id}/delivery`, { rowVersion: d.rowVersion, received: 'none', collectOn: '2026-11-30' }).expect(200);
      c = await caseOf(c202.id);
      expect(c.invoice?.no).toBe(w1.no);
    });

    let w2: Invoice;
    it('W2 — void and re-issue: the ledger stays 320.00, the voided number is never reused', async () => {
      const voided = (await voidIt(w1).expect(200)).body as Invoice;
      expect(voided).toMatchObject({ status: 'void', voidReason: 'خطأ في اختيار الحالات', no: w1.no });
      expect(voided.snapshot).toEqual(w1.snapshot);
      expect(await balance(e)).toBe(32_000);
      expect(await caseOf(c202.id)).toMatchObject({ invoice: null, canEdit: true, editBlockedReason: null });
      const again = await voidIt(voided).expect(409);
      expect(again.body.error.code).toBe('error.invoice.already_void');
      const stale = await voidIt({ id: w1.id, rowVersion: w1.rowVersion }).expect(409);
      expect(stale.body.error.code).toBe('error.invoice.already_void');
      w2 = await issued({ type: 'cases', doctorId: e, caseIds: [c201.id], expectedTotal: 30_000 });
      expect(w2.total).toBe(30_000);
      expect(w2.no).toBe(w1.no + 1); // 1001-style numbers are never reused
      expect(w2.snapshot.balances).toEqual({ previous: 2_000, current: 32_000, pendingCheques: 0 });
      // Edits work again on the un-invoiced case.
      const c = await caseOf(c202.id);
      await patch(`/cases/${c.id}`, { rowVersion: c.rowVersion, notes: 'editable again' }).expect(200);
      expect(await balance(e)).toBe(32_000);
    });

    it('W3 — case discounts: subtotal 500.00, discount 20.00, total 480.00; the ledger stays 300.00', async () => {
      const e3 = await doctor(10_000);
      const a = await newCase(e3, [30_000], { receivedDate: '2026-11-01' });
      const b = await newCase(e3, [20_000], { receivedDate: '2026-11-02', discount: 2_000 });
      await pay({ doctorId: e3, caseId: b.id, method: 'cash', amount: 12_000, paidAt: '2026-11-05' });
      await pay({ doctorId: e3, method: 'cash', amount: 25_000, paidAt: '2026-11-06' });
      await newCase(e3, [15_000], { receivedDate: '2026-11-04' }).then((c) =>
        pay({ doctorId: e3, caseId: c.id, method: 'transfer', amount: 6_000, paidAt: '2026-11-07' }),
      );
      expect(await balance(e3)).toBe(30_000);
      const inv = await issued({ type: 'cases', doctorId: e3, caseIds: [a.id, b.id], expectedTotal: 48_000 });
      expect(inv).toMatchObject({ subtotal: 50_000, discount: 2_000, total: 48_000 });
      expect(inv.snapshot.balances).toMatchObject({ previous: -18_000, current: 30_000 });
      expect(await balance(e3)).toBe(30_000);
      await voidIt(inv).expect(200);
      expect(await balance(e3)).toBe(30_000);
    });

    it('W4 — a free invoice to the doctor never changes his balance (I1)', async () => {
      const inv = await issued({ type: 'free', doctorId: e, reason: 'أجرة توصيل', amount: 2_500 });
      expect(inv).toMatchObject({ type: 'free', subtotal: 2_500, discount: 0, total: 2_500 });
      expect(inv.snapshot.party).toMatchObject({ kind: 'doctor' });
      expect(inv.snapshot.balances).toBeUndefined();
      expect(await balance(e)).toBe(32_000);
      const named = await issued({ type: 'free', partyName: 'عيادة زائرة', reason: 'تصليح', amount: 1_000 });
      expect(named.snapshot.party).toEqual({ kind: 'free', name: 'عيادة زائرة' });
    });

    it('W5 — a statement freezes the closing: 320.00 stays on it after the ledger moves to 380.00', async () => {
      const st = await issued({ type: 'statement', doctorId: e });
      expect(st).toMatchObject({ type: 'statement', total: null, subtotal: null, discount: null });
      expect(st.snapshot.statement?.closing).toBe(32_000);
      await post(`/payments/${transferId}/void`, { rowVersion: transferVersion, reason: 'لم يصل التحويل' }).expect(200);
      expect(await balance(e)).toBe(38_000);
      expect(((await get(`/invoices/${st.id}`).expect(200)).body as Invoice).snapshot.statement?.closing).toBe(32_000);
      const fresh = await issued({ type: 'statement', doctorId: e });
      expect(fresh.snapshot.statement?.closing).toBe(38_000);
      const ranged = await issued({ type: 'statement', doctorId: e, from: '2026-11-03', to: '2026-11-20' });
      expect(ranged.snapshot.statement).toMatchObject({ periodOpening: 10_000 + 30_000 + 20_000 }); // opening + #201 + #202; every payment is dated later
    });

    it('W6 — a pending cheque: current 200.00, previous 0, pending 200.00; clearing it leaves the invoice as issued', async () => {
      const h = await doctor();
      const c = await newCase(h, [20_000]);
      const ch = await pay({ doctorId: h, caseId: c.id, method: 'cheque', amount: 20_000, cheque: { chequeNo: `W6-${seq}`, bank: 'Bank', dueDate: '2026-11-25' } });
      const inv = await issued({ type: 'cases', doctorId: h, caseIds: [c.id], expectedTotal: 20_000 });
      expect(inv.snapshot.balances).toEqual({ previous: 0, current: 20_000, pendingCheques: 20_000 });
      await patch(`/cheques/${ch.body.payment.cheque.id}/status`, { status: 'cleared', rowVersion: ch.body.payment.cheque.rowVersion }).expect(200);
      expect(await balance(h)).toBe(0);
      expect(((await get(`/invoices/${inv.id}`).expect(200)).body as Invoice).snapshot.balances?.current).toBe(20_000);
      // Delivered + invoiced + nothing left = «مغلقة».
      const cur = await caseOf(c.id);
      await post(`/cases/${c.id}/delivery`, { rowVersion: cur.rowVersion }).expect(200);
      const row = ((await get(`/cases?doctorId=${h}`).expect(200)).body as { items: { id: number; closed: boolean; invoice: unknown }[] }).items[0];
      expect(row).toMatchObject({ id: c.id, closed: true, invoice: { id: inv.id, no: inv.no } });
    });
  });

  describe('errors (stable codes, both languages)', () => {
    let d: number;
    let ready: CaseBody;
    beforeAll(async () => {
      d = await doctor();
      ready = await newCase(d, [10_000, 5_000]);
    });
    const code = async (r: request.Test, status: number, expected: string, lang: 'ar' | 'en' = 'ar') => {
      const res = await r.set('Accept-Language', lang).expect(status);
      expect(res.body.error.code).toBe(expected);
      expect(typeof res.body.error.message).toBe('string');
      return res.body.error as { message: string; params: Record<string, unknown> };
    };

    it('request shape per type', async () => {
      await code(post('/invoices', { type: 'free', partyName: 'X', reason: 'r', amount: 1 }), 400, 'error.idempotency.required');
      const f = await code(issue({ type: 'cases', doctorId: d, caseIds: [ready.id] }), 400, 'error.invoice.field_required', 'en');
      expect(f.params).toEqual({ field: 'expectedTotal' });
      await code(issue({ type: 'statement', doctorId: d, amount: 5 }), 400, 'error.invoice.field_not_allowed');
      await code(issue({ type: 'free', reason: 'r', amount: 5 }), 400, 'error.invoice.party_required');
      await code(issue({ type: 'free', doctorId: d, partyName: 'X', reason: 'r', amount: 5 }), 400, 'error.invoice.party_required', 'en');
      await code(issue({ type: 'cases', doctorId: d, caseIds: [ready.id, ready.id], expectedTotal: 0 }), 400, 'error.invoice.case_duplicate');
      await code(issue({ type: 'statement', doctorId: d, from: '2026-11-10', to: '2026-11-01' }), 400, 'error.invoice.range_invalid');
      await code(issue({ type: 'free', partyName: 'X', reason: 'r', amount: 0 }), 400, 'error.validation.failed');
      await code(issue({ type: 'bogus' }), 400, 'error.validation.failed');
      await code(issue({ type: 'free', partyName: 'X', reason: 'r', amount: 5, extra: 1 }), 400, 'error.validation.failed');
    });

    it('cases: not found, other doctor, not finished, already invoiced, total changed', async () => {
      await code(issue({ type: 'cases', doctorId: 999_999, caseIds: [ready.id], expectedTotal: 0 }), 404, 'error.not_found');
      await code(issue({ type: 'cases', doctorId: d, caseIds: [999_999], expectedTotal: 0 }), 404, 'error.not_found');
      const other = await newCase(await doctor(), [1_000]);
      const m = await code(issue({ type: 'cases', doctorId: d, caseIds: [other.id], expectedTotal: 1_000 }), 409, 'error.invoice.case_doctor_mismatch');
      expect(m.params).toEqual({ caseNo: other.caseNo });
      const design = await newCase(d, [1_000], { status: 'design' });
      await code(issue({ type: 'cases', doctorId: d, caseIds: [design.id], expectedTotal: 1_000 }), 409, 'error.invoice.case_not_eligible', 'en');
      const changed = await code(issue({ type: 'cases', doctorId: d, caseIds: [ready.id], expectedTotal: 1 }), 409, 'error.invoice.total_changed');
      expect(changed.params).toEqual({ total: 15_000 });
      await issued({ type: 'cases', doctorId: d, caseIds: [ready.id], expectedTotal: 15_000 });
      const dup = await code(issue({ type: 'cases', doctorId: d, caseIds: [ready.id], expectedTotal: 15_000 }), 409, 'error.invoice.case_already_invoiced', 'en');
      expect(dup.message).toBe('This case is already invoiced.');
      const ar = await code(issue({ type: 'cases', doctorId: d, caseIds: [ready.id], expectedTotal: 15_000 }), 409, 'error.invoice.case_already_invoiced');
      expect(ar.message).toBe('هذه الحالة مفوترة بالفعل.');
    });

    it('idempotency: replay 200 with the same invoice; another body with the key 422', async () => {
      const key = randomUUID();
      const first = await issue({ type: 'free', partyName: 'Same', reason: 'r', amount: 10 }, key).expect(201);
      const replay = await issue({ type: 'free', partyName: 'Same', reason: 'r', amount: 10 }, key).expect(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      await code(issue({ type: 'free', partyName: 'Same', reason: 'r', amount: 11 }, key), 422, 'error.idempotency.mismatch');
    });

    it('a statement longer than 2 000 lines is refused (narrow the range)', async () => {
      const long = await doctor();
      await t.pool.query(
        `INSERT INTO payments (voucher_no, doctor_id, method, amount, currency_code, paid_at, created_by, updated_by)
         SELECT 900000 + g, $1, 'cash', 1, 'ILS', '2026-11-01', 1, 1 FROM generate_series(1, 2001) g`,
        [long],
      );
      await code(issue({ type: 'statement', doctorId: long }), 400, 'error.invoice.statement_too_long');
      const ok = await issued({ type: 'statement', doctorId: long, from: '2026-11-02' });
      expect(ok.snapshot.statement?.lines).toHaveLength(0);
      expect(ok.snapshot.statement?.periodOpening).toBe(-2001);
    });
  });

  describe('concurrency', () => {
    it('two invoices with the same case at once: one wins, one 409, one link', async () => {
      const d = await doctor();
      const c = await newCase(d, [10_000]);
      const both = await Promise.all([
        issue({ type: 'cases', doctorId: d, caseIds: [c.id], expectedTotal: 10_000 }),
        issue({ type: 'cases', doctorId: d, caseIds: [c.id], expectedTotal: 10_000 }),
      ]);
      expect(statusesOf(both)).toEqual([201, 409]);
      const links = await t.pool.query('SELECT count(*)::int AS n FROM invoice_cases WHERE case_id = $1 AND active', [c.id]);
      expect(links.rows[0]).toEqual({ n: 1 });
    });

    it('an invoice racing a price edit of its case: exactly one of them succeeds, the totals never disagree', async () => {
      for (let i = 0; i < 5; i += 1) {
        const d = await doctor();
        const c = await newCase(d, [10_000]);
        const [inv, edit] = await Promise.all([
          issue({ type: 'cases', doctorId: d, caseIds: [c.id], expectedTotal: 10_000 }),
          patch(`/cases/${c.id}/lines/${c.lines[0]!.id}`, { rowVersion: c.rowVersion, unitPrice: 12_000 }),
        ]);
        const pair = [inv.status, edit.status].sort();
        expect([
          [201, 409],
          [200, 409],
        ]).toContainEqual(pair);
        if (inv.status === 201) {
          expect(edit.body.error.code).toBe('error.case.invoiced');
          expect((await caseOf(c.id)).total).toBe(10_000);
        } else {
          expect(inv.body.error.code).toBe('error.invoice.total_changed');
        }
      }
    });
  });

  describe('invoice appearance (template)', () => {
    it('defaults until first saved; save with rowVersion; stale → 409', async () => {
      const first = (await get('/settings/invoice-template').expect(200)).body as { template: Record<string, unknown>; rowVersion: number };
      expect(first.rowVersion).toBe(0);
      expect(first.template).toMatchObject({ fontSize: 'm', showLogo: true, columns: expect.arrayContaining(['lineTotal']) });
      const saved = (await put('/settings/invoice-template', { rowVersion: 0, template: { ...first.template, primaryColor: '#abcdef' } }).expect(200))
        .body as { template: { primaryColor: string }; rowVersion: number };
      expect(saved).toMatchObject({ rowVersion: 1, template: { primaryColor: '#ABCDEF' } });
      const stale = await put('/settings/invoice-template', { rowVersion: 0, template: first.template }).expect(409);
      expect(stale.body.error.code).toBe('error.concurrency.stale');
    });

    it('refuses script tags, event handlers, CSS url() and javascript: in every structured field; footer text stays plain text', async () => {
      const cur = (await get('/settings/invoice-template').expect(200)).body as { template: Record<string, unknown>; rowVersion: number };
      const attacks = ['<script>alert(1)</script>', '#000" onmouseover="alert(1)', 'url(javascript:alert(1))', 'javascript:alert(1)', 'red;background:url(x)'];
      const fields: [string, (a: string) => unknown][] = [
        ['primaryColor', (a) => a],
        ['headerTextColor', (a) => a],
        ['tableHeaderColor', (a) => a],
        ['fontSize', (a) => a],
        ['columns', (a) => ['lineTotal', a]],
        ['widths', (a) => ({ [a]: 20 })],
        ['margins', (a) => ({ top: a, end: 12, bottom: 12, start: 12 })],
        ['showLogo', (a) => a],
        ['showBalances', (a) => a],
      ];
      for (const a of attacks) {
        for (const [field, value] of fields) {
          const r = await put('/settings/invoice-template', { rowVersion: cur.rowVersion, template: { ...cur.template, [field]: value(a) } }).expect(400);
          expect(r.body.error.code).toBe('error.validation.failed');
          expect(JSON.stringify(r.body.error.details)).toContain(`template.${field}`);
        }
      }
      await put('/settings/invoice-template', { rowVersion: cur.rowVersion, template: { ...cur.template, extra: 'x' } }).expect(400);
      const footer = '<img src=x onerror="alert(1)"> url(javascript:x)';
      const ok = (await put('/settings/invoice-template', { rowVersion: cur.rowVersion, template: { ...cur.template, footerText: footer } }).expect(200))
        .body as { template: { footerText: string } };
      expect(ok.template.footerText).toBe(footer);
      // It is frozen as text into the next invoice's layout.
      const inv = await issued({ type: 'free', partyName: 'Footer', reason: 'r', amount: 5 });
      expect((inv.snapshot as unknown as { layout: { footerText: string } }).layout.footerText).toBe(footer);
    });
  });

  describe('list, summary, CSV', () => {
    it('filters by type, status, doctor and number/party; summary counts active per type and voided', async () => {
      const d = await doctor();
      const a = await issued({ type: 'free', doctorId: d, reason: 'List A', amount: 100 });
      const b = await issued({ type: 'statement', doctorId: d });
      await voidIt(b).expect(200);
      const list = (await get(`/invoices?doctorId=${d}`).expect(200)).body as { items: { id: number }[]; total: number };
      expect(list.total).toBe(2);
      expect(list.items.map((i) => i.id)).toEqual([b.id, a.id]);
      expect(((await get(`/invoices?doctorId=${d}&status=void`).expect(200)).body as { total: number }).total).toBe(1);
      expect(((await get(`/invoices?doctorId=${d}&type=free`).expect(200)).body as { items: { id: number }[] }).items.map((i) => i.id)).toEqual([a.id]);
      expect(((await get(`/invoices?search=${a.no}`).expect(200)).body as { items: { id: number }[] }).items.map((i) => i.id)).toContain(a.id);
      const s = (await get('/invoices/summary').expect(200)).body as { active: Record<string, number>; void: number };
      expect(s.void).toBeGreaterThanOrEqual(1);
      expect(s.active.free).toBeGreaterThanOrEqual(1);
    });

    it('CSV: BOM, localized headers, statements without amounts, audited', async () => {
      const res = await get('/exports/invoices?lang=en').buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      const body = res.body as Buffer;
      expect(body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      const text = body.toString('utf8');
      expect(text).toContain('Invoice no.');
      expect(text).toContain('Account statement');
      const audit = await t.pool.query(`SELECT params FROM audit_log WHERE action = 'export.created' ORDER BY id DESC LIMIT 1`);
      expect(audit.rows[0].params).toMatchObject({ report: 'invoices' });
    });
  });

  it('every invoice write is audited with the number (never a patient name)', async () => {
    const rows = await t.pool.query<{ action: string; params: Record<string, unknown> }>(
      `SELECT action, params FROM audit_log WHERE action LIKE 'invoice%' ORDER BY id`,
    );
    expect(rows.rows.some((r) => r.action === 'invoice.created')).toBe(true);
    expect(rows.rows.some((r) => r.action === 'invoice.voided')).toBe(true);
    expect(rows.rows.some((r) => r.action === 'invoice_template.updated')).toBe(true);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Patient \d/);
  });
});
