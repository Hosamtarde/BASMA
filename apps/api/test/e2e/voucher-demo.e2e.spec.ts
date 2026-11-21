import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { amountInWords, formatMoney, parseMoney } from '@app/shared';
import { seedDemo } from '../../scripts/demo/seed';
import { OWNER_PASSWORD, startTestApp, TestApp } from '../support/app';
import { englishWordsToMinor } from '../support/words';

jest.setTimeout(600_000);

interface Row {
  id: number;
  voucherNo: string;
  amount: number;
  currencyCode: string;
  status: string;
  cheque: { chequeNo: string; bank: string; dueDate: string; status: string } | null;
  voidReason: string | null;
  voidedAt: string | null;
}

/**
 * B6b: the figures a voucher prints equal the stored amount, for EVERY payment and expense of the demo
 * installation (built through the real API, extras included: cheques, refunds, voids). For each row the voucher
 * data (`GET /payments/{id}`, `GET /outgoing-payments/{id}`) must equal the list row, the printed figure — the
 * shared formatter the voucher renders with, in both languages — must read back to the stored integer, and the
 * words must read back to it too (English by an independent parser; Arabic must be non-empty, free of digits and
 * of the fallback markers).
 */
describe('Voucher figures equal the stored amounts over the demo data (e2e)', () => {
  let t: TestApp;
  const get = (p: string) => request(t.http).get(`/api/v1${p}`).set('Authorization', t.auth);

  beforeAll(async () => {
    t = await startTestApp();
    await t.app.listen(0, '127.0.0.1');
    const { port } = (t.app.getHttpServer() as Server).address() as AddressInfo;
    await seedDemo({ baseUrl: `http://127.0.0.1:${port}`, username: 'owner', password: OWNER_PASSWORD, extras: true });
  });
  afterAll(async () => {
    await t?.close();
  });

  const all = async (path: string): Promise<Row[]> => {
    const rows: Row[] = [];
    for (let page = 1; ; page += 1) {
      const body = (await get(`${path}?pageSize=100&page=${page}`).expect(200)).body as { items: Row[]; total: number };
      rows.push(...body.items);
      if (rows.length >= body.total || body.items.length === 0) return rows;
    }
  };

  const check = async (detailPath: string, rows: Row[], prefix: string) => {
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const detail = (await get(`${detailPath}/${row.id}`).expect(200)).body as Row;
      expect(detail).toMatchObject({ id: row.id, voucherNo: row.voucherNo, amount: row.amount, status: row.status });
      expect(detail.voucherNo.startsWith(prefix)).toBe(true);
      expect(Number.isSafeInteger(detail.amount) && detail.amount > 0).toBe(true);
      expect(detail.currencyCode).toBe('ILS');
      for (const locale of ['ar-u-nu-latn', 'en-GB']) {
        const printed = formatMoney(detail.amount, 2, locale);
        expect(parseMoney(printed, 2)).toEqual({ ok: true, minor: detail.amount });
      }
      expect(englishWordsToMinor(amountInWords(detail.amount, 2, detail.currencyCode, 'en'))).toBe(detail.amount);
      const arabic = amountInWords(detail.amount, 2, detail.currencyCode, 'ar');
      expect(arabic).toMatch(/^[؀-ۿ ]+$/u);
      expect(arabic).toContain('شيكل');
    }
  };

  it('every incoming payment (cash, transfer, cheque, bound, voided)', async () => {
    const rows = await all('/payments');
    expect(rows.some((r) => r.status === 'void')).toBe(true);
    expect(rows.some((r) => r.cheque !== null)).toBe(true);
    await check('/payments', rows, 'IN-');
  });

  it('every outgoing payment (expenses, doctor refunds, cheques, voided)', async () => {
    const rows = await all('/outgoing-payments');
    expect(rows.some((r) => r.cheque !== null)).toBe(true);
    await check('/outgoing-payments', rows, 'OUT-');
  });
});
