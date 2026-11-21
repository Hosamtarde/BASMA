import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiPost, apiPostKey, apiToken, expectAccessible, setLanguage, shot, signedIn, uid } from './support';

/**
 * B6b (SPEC §5.8, §5.9; docs/plans/b6b-vouchers-and-cleanup.md): printing the receipt voucher of an incoming payment
 * and the payment voucher of an expense from the lists, the A4 preview, the print view, a voided voucher, the
 * amount in words in both languages, injection attempts that must never execute, and the one identity that may be
 * printed (the lab's). Printing reads only: every request the page makes is a GET. Run with TZ=UTC.
 */
const REPORT_SIZE = { width: 1440, height: 900 };
const TODAY = new Date().toISOString().slice(0, 10);

interface Seed {
  token: string;
  suffix: string;
  doctor: { id: number; name: string };
  workTypeId: number;
}
interface PaymentBody {
  payment: { id: number; voucherNo: string; rowVersion: number };
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', { name: `زيركون ${suffix}`, unitPrice: 25000 });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', { name: `د. سندات ${suffix}` });
  return { token, suffix, doctor, workTypeId: workType.id };
}

/** window.print is replaced so a test can count print requests without a dialog. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: number; print: () => void };
    w.__printed = 0;
    w.print = () => {
      w.__printed += 1;
    };
  });
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: number }).__printed);
const voucherDoc = (page: Page) => page.locator('[data-voucher-document]');

/** No image but the lab's own logo, no product name, no "Powered by" (SPEC §2.3). */
async function expectOnlyLabIdentity(page: Page) {
  await expect(voucherDoc(page).locator('img:not([data-lab-logo])')).toHaveCount(0);
  const text = (await voucherDoc(page).textContent()) ?? '';
  expect(text).not.toMatch(/Basma|بسمة|Smile Artec|Powered by/i);
}

/** Every request the page makes while it is open and printed is a read. */
function watchWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (r) => {
    // The silent token refresh is session upkeep, not data.
    if (r.url().includes('/api/') && r.method() !== 'GET' && !r.url().endsWith('/auth/refresh')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}

test.describe('B6b vouchers', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(REPORT_SIZE);
    await stubPrint(page);
  });

  test('receipt voucher (ar): from the payments list to the A4 preview and print, words and figures agree, nothing is written', async ({ page, request }) => {
    const s = await seed(request);
    const c = await apiPost<{ id: number; caseNo: number }>(request, s.token, '/cases', {
      doctorId: s.doctor.id,
      patientName: `مريض ${s.suffix}`,
      expectedDate: '2099-12-31',
      lines: [{ toothNo: 11, workTypeId: s.workTypeId, unitPrice: 500_000 }],
    });
    const p = await apiPostKey<PaymentBody>(request, s.token, '/payments', {
      doctorId: s.doctor.id,
      caseId: c.id,
      method: 'cash',
      amount: 100050,
      paidAt: TODAY,
      notes: `دفعة أولى ${s.suffix}`,
    });
    await signedIn(page);
    await setLanguage(page, 'ar');
    await page.goto(`/payments?q=${encodeURIComponent(s.doctor.name)}`);
    const writes = watchWrites(page);
    await expectAccessible(page);
    await page.locator(`[data-voucher-link="${p.payment.voucherNo}"]`).click();

    await expect(page.getByRole('heading', { level: 1, name: `سند قبض ${p.payment.voucherNo}` })).toBeVisible();
    const doc = voucherDoc(page);
    await expect(doc).toHaveAttribute('dir', 'rtl');
    await expect(doc.locator('[data-voucher-no]')).toHaveText(p.payment.voucherNo);
    await expect(doc.locator('[data-voucher-party]')).toHaveText(s.doctor.name);
    await expect(doc.locator('[data-voucher-amount]')).toHaveText('1,000.50 ₪');
    await expect(doc.locator('[data-voucher-words]')).toHaveText('ألف شيكل وخمسون أغورة');
    await expect(doc.locator('[data-voucher-method]')).toHaveText('نقدًا');
    await expect(doc.locator('[data-voucher-case]')).toHaveText(String(c.caseNo));
    await expect(doc.locator('[data-voucher-notes]')).toContainText(`دفعة أولى ${s.suffix}`);
    await expectOnlyLabIdentity(page);
    await expectAccessible(page);
    await shot(page, 'voucher-receipt-ar');

    // Print view: the app shell and the controls are gone, only the sheet prints, on one A4 page.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(page.getByRole('button', { name: 'طباعة' })).toBeHidden();
    await expect(doc).toBeVisible();
    await shot(page, 'voucher-print-ar');
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0).toBe(1);
    await page.emulateMedia({ media: 'screen' });

    await page.getByRole('button', { name: 'طباعة' }).click();
    await expect.poll(() => printed(page)).toBe(1);
    await page.getByRole('button', { name: 'حفظ PDF' }).click();
    await expect.poll(() => printed(page)).toBe(2);
    expect(writes).toEqual([]);
  });

  test('payment voucher (en): a cheque expense with its number, bank and due date; the reprint language switch changes labels and words only', async ({ page, request }) => {
    const s = await seed(request);
    const category = await apiPost<{ id: number }>(request, s.token, '/expense-categories', { name: `إيجار ${s.suffix}` });
    const o = await apiPostKey<PaymentBody>(request, s.token, '/outgoing-payments', {
      categoryId: category.id,
      payee: `مؤجّر ${s.suffix}`,
      method: 'cheque',
      amount: 200_000_000,
      paidAt: TODAY,
      cheque: { chequeNo: `CH-${s.suffix}`, bank: 'بنك فلسطين', dueDate: '2099-01-15' },
    });
    await signedIn(page);
    await setLanguage(page, 'en');
    await page.goto(`/outgoing?q=${encodeURIComponent(s.suffix)}`);
    const writes = watchWrites(page);
    await page.locator(`[data-voucher-link="${o.payment.voucherNo}"]`).click();

    await expect(page.getByRole('heading', { level: 1, name: `Payment voucher ${o.payment.voucherNo}` })).toBeVisible();
    const doc = voucherDoc(page);
    // The document language is the Settings one (Arabic here); the reprint switch gives English.
    await page.getByRole('combobox', { name: 'Print language' }).selectOption('en');
    await expect(doc).toHaveAttribute('dir', 'ltr');
    await expect(doc.locator('[data-voucher-amount]')).toHaveText('2,000,000.00 ₪');
    await expect(doc.locator('[data-voucher-words]')).toHaveText('Two million shekels');
    await expect(doc.locator('[data-voucher-party]')).toHaveText(`مؤجّر ${s.suffix}`);
    await expect(doc.locator('[data-voucher-category]')).toHaveText(`إيجار ${s.suffix}`);
    const cheque = doc.locator('[data-voucher-cheque]');
    await expect(cheque).toContainText(`CH-${s.suffix}`);
    await expect(cheque).toContainText('بنك فلسطين');
    await expect(cheque).toContainText('2099-01-15');
    await expect(cheque).toContainText('Pending collection');
    await expectOnlyLabIdentity(page);
    await expectAccessible(page);
    await shot(page, 'voucher-payment-en');
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('complementary')).toBeHidden();
    await shot(page, 'voucher-print-en');
    await page.emulateMedia({ media: 'screen' });

    await page.getByRole('combobox', { name: 'Print language' }).selectOption('ar');
    await expect(doc).toHaveAttribute('dir', 'rtl');
    await expect(doc.locator('[data-voucher-amount]')).toHaveText('2,000,000.00 ₪');
    await expect(doc.locator('[data-voucher-words]')).toHaveText('مليونان شيكل');
    await shot(page, 'voucher-payment-ar');
    expect(writes).toEqual([]);
  });

  test('a voided payment still prints, marked void with its date and reason; the number is kept', async ({ page, request }) => {
    const s = await seed(request);
    const p = await apiPostKey<PaymentBody>(request, s.token, '/payments', {
      doctorId: s.doctor.id,
      method: 'transfer',
      amount: 777,
      paidAt: TODAY,
    });
    const res = await request.post(`/api/v1/payments/${p.payment.id}/void`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { rowVersion: p.payment.rowVersion, reason: `مبلغ خاطئ ${s.suffix}` },
    });
    expect(res.status()).toBe(200);
    await signedIn(page);
    await setLanguage(page, 'ar');
    await page.goto(`/payments/${p.payment.id}/voucher`);
    const doc = voucherDoc(page);
    await expect(doc.locator('[data-void-band]')).toContainText('ملغى');
    await expect(doc.locator('[data-void-band]')).toContainText(`مبلغ خاطئ ${s.suffix}`);
    await expect(doc.locator('[data-void-band]')).toContainText(TODAY);
    await expect(doc.locator('[data-voucher-no]')).toHaveText(p.payment.voucherNo);
    await expect(doc.locator('[data-voucher-words]')).toHaveText('سبعة شواكل وسبع وسبعون أغورة');
    await shot(page, 'voucher-void-ar');
    await expectAccessible(page);
  });

  test('injection: names, notes, bank, cheque number, payee and void reason are shown as text and never run', async ({ page, request }) => {
    const s = await seed(request);
    const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>${s.suffix}`;
    const shortEvil = `<img src=x onerror=window.__pwned=1>`;
    const chequeEvil = '<img src=x onerror=alert(1)>';
    const category = await apiPost<{ id: number }>(request, s.token, '/expense-categories', { name: `فئة ${s.suffix}` });
    const o = await apiPostKey<PaymentBody>(request, s.token, '/outgoing-payments', {
      categoryId: category.id,
      payee: evil,
      method: 'cheque',
      amount: 12345,
      paidAt: TODAY,
      notes: evil,
      cheque: { chequeNo: chequeEvil, bank: shortEvil, dueDate: '2099-01-15' },
    });
    const res = await request.post(`/api/v1/outgoing-payments/${o.payment.id}/void`, {
      headers: { Authorization: `Bearer ${s.token}` },
      data: { rowVersion: o.payment.rowVersion, reason: evil },
    });
    expect(res.status()).toBe(200);
    await signedIn(page);
    await setLanguage(page, 'en');
    await page.goto(`/outgoing/${o.payment.id}/voucher`);
    const doc = voucherDoc(page);
    await expect(doc.locator('[data-voucher-party]')).toContainText(evil);
    await expect(doc.locator('[data-voucher-notes]')).toContainText(evil);
    await expect(doc.locator('[data-void-band]')).toContainText(evil);
    await expect(doc.locator('[data-voucher-cheque]')).toContainText(shortEvil);
    await expect(doc.locator('[data-voucher-cheque]')).toContainText(chequeEvil);
    for (const media of ['screen', 'print'] as const) {
      await page.emulateMedia({ media });
      await expect(doc.locator('script, img[src="x"], [onerror]')).toHaveCount(0);
    }
    await page.emulateMedia({ media: 'screen' });
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expectOnlyLabIdentity(page);
  });

  test('?print=1 opens the dialog once and the flag is dropped; an unknown voucher shows the error page, not a blank sheet', async ({ page, request }) => {
    const s = await seed(request);
    const p = await apiPostKey<PaymentBody>(request, s.token, '/payments', {
      doctorId: s.doctor.id,
      method: 'cash',
      amount: 500,
      paidAt: TODAY,
    });
    await signedIn(page);
    await setLanguage(page, 'ar');
    await page.goto(`/payments/${p.payment.id}/voucher?print=1`);
    await expect(voucherDoc(page)).toBeVisible();
    await expect.poll(() => printed(page)).toBe(1);
    await expect(page).not.toHaveURL(/print=1/);
    await page.goto('/payments/99999999/voucher');
    await expect(voucherDoc(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible();
    await expect(page.locator('[data-print-button]')).toHaveCount(0);
  });
});
