import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DB } from '../../src/shared/db/database';
import { ExportsService } from '../../src/modules/exports/application/exports.service';
import { FakeClock, startTestApp, TestApp } from '../support/app';
import { tokenWith } from '../support/tokens';

jest.setTimeout(300_000);

const NOON = '2026-11-10T10:00:00Z'; // 12:00 in Hebron
const TODAY = '2026-11-10';
const BOM_BYTES = [0xef, 0xbb, 0xbf];

/** Minimal RFC 4180 reader for the tests (quotes, doubled quotes, CRLF inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

interface Csv {
  raw: Buffer;
  text: string;
  rows: string[][];
  header: string[];
  data: string[][];
  res: request.Response;
}

describe('B4 CSV exports (e2e)', () => {
  let t: TestApp;
  const clock = new FakeClock(new Date(NOON));
  const api = (p: string) => `/api/v1${p}`;
  let workType: number;
  let creditDoctor: number;
  let debtDoctor: number;
  let hostileDoctor: number;

  const post = (p: string, body: object, key?: string) => {
    const r = request(t.http).post(api(p)).set('Authorization', t.auth);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  const doctor = async (name: string, opening = 0) =>
    (await post('/doctors', { name, openingBalance: opening }).expect(201)).body.id as number;
  const kase = async (doctorId: number, price: number, patientName: string, receivedDate = TODAY) =>
    (
      await post('/cases', {
        doctorId,
        patientName,
        receivedDate,
        expectedDate: '2026-12-31',
        lines: [{ toothNo: 11, workTypeId: workType, unitPrice: price }],
      }).expect(201)
    ).body as { id: number; caseNo: number; rowVersion: number };
  const pay = async (body: object) =>
    (await post('/payments', body, randomUUID()).expect(201)).body as {
      payment: { id: number; rowVersion: number; cheque: { id: number; rowVersion: number } | null };
    };

  async function csv(path: string, auth?: string, headers: Record<string, string> = {}): Promise<Csv> {
    const res = await request(t.http)
      .get(api(path))
      .set('Authorization', auth ?? t.auth)
      .set(headers)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const raw = res.body as Buffer;
    const text = raw.toString("utf8").replace(/^\uFEFF/, "");
    const rows = parseCsv(text);
    return { raw, text, rows, header: rows[0] ?? [], data: rows.slice(1), res };
  }
  const audits = async (action = 'export.created') =>
    (
      await t.pool.query<{ user_id: string; entity_id: string; params: Record<string, unknown> }>(
        `SELECT user_id, entity_id, params FROM audit_log WHERE action = $1 ORDER BY id`,
        [action],
      )
    ).rows;

  beforeAll(async () => {
    t = await startTestApp({}, { clock });
    const s = await request(t.http).get(api('/settings')).set('Authorization', t.auth).expect(200);
    await request(t.http)
      .patch(api('/settings/lab-profile'))
      .set('Authorization', t.auth)
      .send({ rowVersion: s.body.labProfile.rowVersion, timeZone: 'Asia/Hebron' })
      .expect(200);
    t.app.get(ExportsService).ratePerMinute = 1000; // the 429 test lowers it again
    workType = (await post('/work-types', { name: 'Zirconia', unitPrice: 1000 }).expect(201)).body.id as number;

    // A doctor who owes (E1 numbers), one with credit, and a hostile name.
    debtDoctor = await doctor('Dr Debt, "Quoted"', 10000);
    const c1 = await kase(debtDoctor, 30000, 'Patient One', '2026-11-01');
    const c2 = await kase(debtDoctor, 20000, 'مريض عربي', '2026-11-02');
    const c3 = await kase(debtDoctor, 15000, 'Patient Three', '2026-11-04');
    await pay({ doctorId: debtDoctor, method: 'cash', amount: 12000, caseId: c2.id });
    await pay({ doctorId: debtDoctor, method: 'cash', amount: 25000, notes: 'line1\nline2, with "quotes"' });
    await pay({ doctorId: debtDoctor, method: 'transfer', amount: 6000, caseId: c3.id });
    const chq = (
      await pay({
        doctorId: debtDoctor,
        method: 'cheque',
        amount: 5000,
        cheque: { chequeNo: 'CH-1', bank: 'Bank of Palestine', dueDate: '2026-11-20' },
      })
    ).payment;
    expect(chq.cheque).not.toBeNull();
    const voided = (await pay({ doctorId: debtDoctor, method: 'cash', amount: 100 })).payment;
    await post(`/payments/${voided.id}/void`, { rowVersion: voided.rowVersion, reason: 'typo =1+1' }).expect(200);
    void c1;

    creditDoctor = await doctor('د. دائن');
    await kase(creditDoctor, 10000, 'Patient Credit');
    await pay({ doctorId: creditDoctor, method: 'cash', amount: 15000 });

    hostileDoctor = await doctor('=HYPERLINK("http://evil","click")');
    await kase(hostileDoctor, 700, '@SUM(A1)');
    await doctor('-2+3 clinic');
  });
  afterAll(async () => {
    await t?.close();
  });

  describe('permissions', () => {
    const routes = (): string[] => [
      '/exports/debts',
      `/exports/doctors/${debtDoctor}/debt-breakdown`,
      `/exports/doctors/${debtDoctor}/statement`,
      '/exports/payments',
    ];

    it('401 without a token and 403 for a token with no permissions', async () => {
      for (const r of routes()) {
        await request(t.http).get(api(r)).expect(401);
        await request(t.http).get(api(r)).set('Authorization', t.limitedAuth).expect(403);
      }
    });

    it('reading is not enough: ledger.read / payments.read without exports.run is refused', async () => {
      const readOnly = await tokenWith(t, ['ledger.read', 'cases.read', 'payments.read']);
      for (const r of routes()) {
        const res = await request(t.http).get(api(r)).set('Authorization', readOnly).expect(403);
        expect(res.body.error.code).toBe('error.auth.forbidden');
      }
    });

    it('exports.run alone is refused too (it does not grant reading)', async () => {
      const exportOnly = await tokenWith(t, ['exports.run']);
      for (const r of routes()) await request(t.http).get(api(r)).set('Authorization', exportOnly).expect(403);
    });

    it('the breakdown file also needs cases.read (it carries patient names)', async () => {
      const noCases = await tokenWith(t, ['ledger.read', 'exports.run']);
      await request(t.http)
        .get(api(`/exports/doctors/${debtDoctor}/debt-breakdown`))
        .set('Authorization', noCases)
        .expect(403);
      await csv('/exports/debts', noCases);
      await csv(`/exports/doctors/${debtDoctor}/debt-breakdown`, await tokenWith(t, ['ledger.read', 'cases.read', 'exports.run']));
    });

    it('a refused export leaves no audit entry', async () => {
      expect(await audits()).not.toContainEqual(expect.objectContaining({ entity_id: 'never' }));
      const before = (await audits()).length;
      await request(t.http).get(api('/exports/debts')).set('Authorization', t.limitedAuth).expect(403);
      expect((await audits()).length).toBe(before);
    });

    it('unknown query keys and bad values are 400; an unknown doctor is 404', async () => {
      await request(t.http).get(api('/exports/debts?bogus=1')).set('Authorization', t.auth).expect(400);
      await request(t.http).get(api('/exports/debts?lang=fr')).set('Authorization', t.auth).expect(400);
      await request(t.http).get(api('/exports/payments?page=2')).set('Authorization', t.auth).expect(400);
      await request(t.http).get(api('/exports/doctors/999999/statement')).set('Authorization', t.auth).expect(404);
      await request(t.http).get(api('/exports/doctors/999999/debt-breakdown')).set('Authorization', t.auth).expect(404);
    });
  });

  describe('file format', () => {
    it('is UTF-8 with a BOM, CRLF line ends, safe headers and a plain ASCII file name', async () => {
      const f = await csv('/exports/debts');
      expect([...f.raw.subarray(0, 3)]).toEqual(BOM_BYTES);
      expect(f.res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(f.res.headers['content-disposition']).toMatch(/^attachment; filename="[a-z0-9-]+-debts-2026-11-10\.csv"$/);
      expect(f.res.headers['cache-control']).toBe('no-store');
      expect(f.res.headers['x-content-type-options']).toBe('nosniff');
      expect(f.text.endsWith('\r\n')).toBe(true);
      expect(f.text.replaceAll('\r\n', '')).not.toContain('\n'.repeat(1) + 'x'); // no bare LF between records
      expect(f.text.split('\r\n').length).toBeGreaterThan(2);
    });

    it('headers are Arabic by default, English with ?lang=en or Accept-Language: en', async () => {
      const ar = await csv('/exports/debts');
      expect(ar.header).toEqual(['الطبيب', 'الاتجاه', 'المبلغ (ILS)', 'الرصيد (ILS)', 'شيكات قيد التحصيل (ILS)']);
      const en = await csv('/exports/debts?lang=en');
      expect(en.header).toEqual(['Doctor', 'Direction', 'Amount (ILS)', 'Balance (ILS)', 'Pending cheques (ILS)']);
      const viaHeader = await csv('/exports/debts', undefined, { 'Accept-Language': 'en-US,en;q=0.9' });
      expect(viaHeader.header).toEqual(en.header);
      // The explicit parameter wins over the header.
      const both = await csv('/exports/debts?lang=ar', undefined, { 'Accept-Language': 'en' });
      expect(both.header).toEqual(ar.header);
    });

    it('neutralises formula injection in text cells but never in amounts', async () => {
      const f = await csv('/exports/debts?lang=en');
      const names = f.data.map((r) => r[0]);
      expect(names).toContain(`'=HYPERLINK("http://evil","click")`);
      for (const r of f.data) {
        expect(r[0]).not.toMatch(/^[=+\-@\t\r]/);
        expect(r[3]).toMatch(/^-?\d+\.\d{2}$/); // balance: a plain signed decimal, never quoted
      }
      const breakdown = await csv(`/exports/doctors/${hostileDoctor}/debt-breakdown?lang=en`);
      expect(breakdown.data[0]?.[2]).toBe("'@SUM(A1)");
      const pays = await csv('/exports/payments?lang=en');
      expect(pays.data.map((r) => r[14]).join('|')).toContain('line1\nline2, with "quotes"');
      expect(pays.data.map((r) => r[13])).toContain('typo =1+1');
    });
  });

  describe('debts', () => {
    it('has one row per doctor with a balance, equal to GET /debts, with exact money text', async () => {
      const f = await csv('/exports/debts?lang=en');
      const list = (await request(t.http).get(api('/debts?pageSize=100')).set('Authorization', t.auth).expect(200)).body as {
        total: number;
        items: { doctor: { name: string }; balance: number; direction: string }[];
      };
      expect(f.data).toHaveLength(list.total);
      expect(Number(f.res.headers['x-export-rows'])).toBe(list.total);
      const debt = f.data.find((r) => r[0] === 'Dr Debt, "Quoted"')!;
      // E1 numbers + a 50.00 cheque still pending (not counted): 320.00 owed.
      expect(debt).toEqual(['Dr Debt, "Quoted"', 'Owed to the lab', '320.00', '320.00', '50.00']);
      const credit = f.data.find((r) => r[0] === 'د. دائن')!;
      expect(credit).toEqual(['د. دائن', 'Owed by the lab', '50.00', '-50.00', '0.00']);
      // Order is the screen's: absolute amount desc.
      const amounts = f.data.map((r) => Number(r[2]));
      expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    });

    it('honours direction and search; the search text is not in the audit entry', async () => {
      const toLab = await csv('/exports/debts?direction=owed_to_lab&lang=en');
      expect(toLab.data.every((r) => r[1] === 'Owed to the lab')).toBe(true);
      const byLab = await csv('/exports/debts?direction=owed_by_lab&lang=en');
      expect(byLab.data.map((r) => r[0])).toEqual(['د. دائن']);
      const found = await csv(`/exports/debts?search=${encodeURIComponent('دائن')}&lang=en`);
      expect(found.data).toHaveLength(1);
      const last = (await audits()).at(-1)!;
      expect(JSON.stringify(last.params)).not.toContain('دائن');
      expect(last.params).toMatchObject({ report: 'debts', filter_hasSearch: true, filter_direction: 'all' });
    });
  });

  describe('debt breakdown: the Remaining column sums to the balance', () => {
    it('lists the open cases of E1 and the sum equals GET /balance', async () => {
      const f = await csv(`/exports/doctors/${debtDoctor}/debt-breakdown?lang=en`);
      expect(f.header).toEqual([
        'Type',
        'Case no.',
        'Patient',
        'Received',
        'Status',
        'Total (ILS)',
        'Paid (ILS)',
        'Remaining (ILS)',
        // B4b: the voucher of a refund row, last so the B4 positions stay.
        'Voucher',
      ]);
      const cases = f.data.filter((r) => r[0] === 'Case');
      expect(cases.map((r) => [r[2], r[5], r[6], r[7]])).toEqual([
        ['Patient One', '300.00', '150.00', '150.00'],
        ['مريض عربي', '200.00', '120.00', '80.00'],
        ['Patient Three', '150.00', '60.00', '90.00'],
      ]);
      expect(cases[0]?.[3]).toBe('2026-11-01');
      const balance = (await request(t.http).get(api(`/doctors/${debtDoctor}/balance`)).set('Authorization', t.auth).expect(200))
        .body.balance as number;
      const sumMinor = f.data.reduce((s, r) => s + BigInt(Math.round(Number(r[7]) * 100)), 0n);
      expect(Number(sumMinor)).toBe(balance);
    });

    it('shows an unpaid opening balance and a credit as their own rows', async () => {
      const credit = await csv(`/exports/doctors/${creditDoctor}/debt-breakdown?lang=en`);
      expect(credit.data).toEqual([['Credit', '', '', '', '', '', '', '-50.00', '']]);
      const arabic = await csv(`/exports/doctors/${creditDoctor}/debt-breakdown`);
      expect(arabic.data[0]?.[0]).toBe('رصيد دائن');
    });
  });

  describe('statement', () => {
    it('starts with the period opening, ends at the closing balance, in running order', async () => {
      const f = await csv(`/exports/doctors/${debtDoctor}/statement?lang=en`);
      expect(f.header).toEqual([
        'Date',
        'Type',
        'Reference',
        'Description',
        'Debit (ILS)',
        'Credit (ILS)',
        'Balance (ILS)',
      ]);
      expect(f.data[0]).toEqual(['', 'Opening for the period', '', '', '', '', '100.00']);
      const st = (await request(t.http).get(api(`/doctors/${debtDoctor}/statement?pageSize=100`)).set('Authorization', t.auth).expect(200))
        .body as { closing: number; total: number };
      expect(f.data).toHaveLength(st.total + 1);
      expect(f.data.at(-1)?.[6]).toBe((st.closing / 100).toFixed(2)); // test-side formatting of a known integer
      const caseLine = f.data.find((r) => r[1] === 'Case' && r[3] === 'مريض عربي')!;
      expect(caseLine[4]).toBe('200.00');
      const chequeLine = f.data.find((r) => (r[3] ?? '').includes('CH-1'));
      expect(chequeLine).toBeUndefined(); // pending cheques are not statement lines
      const payLine = f.data.find((r) => r[1] === 'Payment' && r[3] === 'Bank transfer')!;
      expect(payLine[2]).toMatch(/^IN-\d{6}$/);
      expect(payLine[5]).toBe('60.00');
    });

    it('honours the date range and omits patient names without cases.read', async () => {
      const ranged = await csv(`/exports/doctors/${debtDoctor}/statement?from=2026-11-03&to=2026-11-30&lang=en`);
      expect(ranged.data[0]?.[0]).toBe('2026-11-03');
      expect(ranged.data[0]?.[6]).toBe('600.00'); // 100 opening + cases of 11-01 (300) and 11-02 (200)
      const noCases = await csv(
        `/exports/doctors/${debtDoctor}/statement?lang=en`,
        await tokenWith(t, ['ledger.read', 'exports.run']),
      );
      expect(noCases.text).not.toContain('مريض عربي');
      expect(noCases.data.some((r) => r[1] === 'Case' && r[3] === '')).toBe(true);
    });
  });

  describe('payments', () => {
    it('lists every payment of the filter, voided rows marked, with cheque columns', async () => {
      const f = await csv(`/exports/payments?doctorId=${debtDoctor}&lang=en`);
      expect(f.header).toEqual([
        'Voucher',
        'Payment date',
        'Collection date',
        'Doctor',
        'Method',
        'Cheque no.',
        'Bank',
        'Due date',
        'Case no.',
        'Amount (ILS)',
        'Status',
        'Counted',
        'Cheque status',
        'Void reason',
        'Notes',
      ]);
      const list = (await request(t.http).get(api(`/payments?doctorId=${debtDoctor}&pageSize=100`)).set('Authorization', t.auth).expect(200))
        .body as { total: number };
      expect(f.data).toHaveLength(list.total);
      const cheque = f.data.find((r) => r[5] === 'CH-1')!;
      expect(cheque[4]).toBe('Cheque');
      expect(cheque.slice(9, 13)).toEqual(['50.00', 'Active', 'No', 'Pending collection']);
      expect(cheque[2]).toBe(''); // pending: no collection date
      const voided = f.data.find((r) => r[10] === 'Cancelled')!;
      expect(voided.slice(9, 14)).toEqual(['1.00', 'Cancelled', 'No', '', 'typo =1+1']);
      const cash = f.data.find((r) => r[4] === 'Cash' && r[9] === '120.00')!;
      expect(cash[2]).toBe(TODAY);
      expect(cash[8]).not.toBe('');
    });

    it('honours method, counted, date and search filters like the list', async () => {
      const transfers = await csv('/exports/payments?method=transfer&lang=en');
      expect(transfers.data.length).toBeGreaterThan(0);
      expect(transfers.data.every((r) => r[4] === 'Bank transfer')).toBe(true);
      const notCounted = await csv('/exports/payments?counted=false&lang=en');
      expect(notCounted.data.every((r) => r[11] === 'No')).toBe(true);
      const none = await csv('/exports/payments?from=2020-01-01&to=2020-01-31&lang=en');
      expect(none.data).toEqual([]);
      expect(none.header).toHaveLength(15);
      const bySearch = await csv('/exports/payments?search=CH-1&lang=en');
      expect(bySearch.data).toHaveLength(1);
      const same = (await request(t.http).get(api('/payments?search=CH-1')).set('Authorization', t.auth).expect(200)).body.total;
      expect(same).toBe(1);
    });
  });

  describe('limits, audit and rate', () => {
    it('refuses a file above the row cap with 422 and writes no audit entry', async () => {
      const svc = t.app.get(ExportsService);
      const before = (await audits()).length;
      svc.rowLimit = 2;
      try {
        const res = await request(t.http).get(api('/exports/payments')).set('Authorization', t.auth).expect(422);
        expect(res.body.error.code).toBe('error.export.too_large');
        expect(res.body.error.params).toMatchObject({ limit: 2 });
        expect(res.body.error.params.rows).toBeGreaterThan(2);
        // Narrower filters fit.
        const ok = await request(t.http).get(api('/exports/payments?search=CH-1')).set('Authorization', t.auth).expect(200);
        expect(ok.headers['x-export-rows']).toBe('1');
        const arabic = await request(t.http).get(api('/exports/debts')).set('Authorization', t.auth).set('Accept-Language', 'ar');
        expect(arabic.status).toBe(422);
        expect(arabic.body.error.message).toContain('ضيّق الفلاتر');
      } finally {
        svc.rowLimit = 50_000;
      }
      expect((await audits()).length).toBe(before + 1); // only the successful one
    });

    it('writes one audit entry per file with the user, report, row count and filters', async () => {
      const me = (await request(t.http).get(api('/auth/me')).set('Authorization', t.auth).expect(200)).body.id as number;
      await csv(`/exports/doctors/${debtDoctor}/statement?from=2026-11-01&to=2026-11-30`);
      const last = (await audits()).at(-1)!;
      expect(Number(last.user_id)).toBe(me);
      expect(last.entity_id).toBe('statement');
      expect(last.params).toMatchObject({
        report: 'statement',
        format: 'csv',
        language: 'ar',
        filter_doctorId: debtDoctor,
        filter_from: '2026-11-01',
        filter_to: '2026-11-30',
      });
      expect(typeof last.params.rows).toBe('number');
      // No patient names anywhere in any export audit entry (owner decision B2).
      const all = JSON.stringify(await audits());
      for (const name of ['Patient One', 'مريض عربي', 'Patient Three']) expect(all).not.toContain(name);
    });

    it('refuses to hand out a file when its audit entry cannot be written (fail closed)', async () => {
      await t.pool.query(`CREATE OR REPLACE FUNCTION block_export_audit() RETURNS trigger AS $$ BEGIN
        IF NEW.action = 'export.created' THEN RAISE EXCEPTION 'audit blocked'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
      await t.pool.query(`CREATE TRIGGER block_export_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION block_export_audit()`);
      try {
        const res = await request(t.http).get(api('/exports/debts')).set('Authorization', t.auth);
        expect(res.status).toBe(500);
        expect(res.headers['content-type']).not.toContain('text/csv');
        expect(res.text).not.toContain('Doctor');
      } finally {
        await t.pool.query('DROP TRIGGER block_export_audit ON audit_log');
      }
    });

    it('reads one consistent snapshot: read-only, REPEATABLE READ', async () => {
      const db = t.app.get<{ transaction: (...a: unknown[]) => unknown }>(DB);
      const original = db.transaction.bind(db);
      const seen: unknown[] = [];
      db.transaction = (...a: unknown[]) => {
        seen.push(a[1]);
        return original(...a);
      };
      try {
        await csv('/exports/debts');
      } finally {
        db.transaction = original;
      }
      expect(seen).toContainEqual({ isolationLevel: 'repeatable read', accessMode: 'read only' });
    });

    it('limits each user to a few files per minute (429)', async () => {
      const svc = t.app.get(ExportsService);
      const fresh = await tokenWith(t, ['ledger.read', 'exports.run']);
      // A different user id would be needed for a clean window; the owner id is shared, so lower the cap.
      svc.ratePerMinute = 0;
      try {
        const res = await request(t.http).get(api('/exports/debts')).set('Authorization', fresh);
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('error.rate_limited');
      } finally {
        svc.ratePerMinute = 1000;
      }
    });
  });
});
