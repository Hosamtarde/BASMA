import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  apiPost,
  apiPostKey,
  apiToken,
  expectAccessible,
  expectDirection,
  readDownload,
  setLanguage,
  shot,
  signedIn,
  uid,
} from './support';

/**
 * B4 (SPEC §5.11, §5.17, §10): the debts breakdown, CSV exports, the receipts summary, paid /
 * remaining and balance columns, and global search. Every test seeds its own uniquely named
 * doctor through the real API and is independent of the others. Run with TZ=UTC.
 */
const DESKTOP = { width: 1440, height: 900 };
const TODAY = new Date().toISOString().slice(0, 10);

interface Seed {
  token: string;
  suffix: string;
  doctor: { id: number; name: string };
  workType: { id: number };
}

async function seed(request: APIRequestContext, opening = 0, namePrefix = 'د. سامي'): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', { name: `تاج ${suffix}`, unitPrice: 40000 });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', {
    name: `${namePrefix} ${suffix}`,
    openingBalance: opening,
  });
  return { token, suffix, doctor, workType };
}

const newCase = (request: APIRequestContext, s: Seed, price: number, receivedDate = TODAY, patientName?: string) =>
  apiPost<{ id: number; caseNo: number; rowVersion: number }>(request, s.token, '/cases', {
    doctorId: s.doctor.id,
    patientName: patientName ?? `مريض ${s.suffix}`,
    receivedDate,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: s.workType.id, unitPrice: price }],
  });

const newPayment = (request: APIRequestContext, s: Seed, body: Record<string, unknown>) =>
  apiPostKey<{ payment: { id: number; voucherNo: string; rowVersion: number; cheque: { id: number; rowVersion: number } | null } }>(
    request,
    s.token,
    '/payments',
    { doctorId: s.doctor.id, ...body },
  );

const balanceOf = async (request: APIRequestContext, s: Seed): Promise<number> => {
  const res = await request.get(`/api/v1/doctors/${s.doctor.id}/balance`, { headers: { Authorization: `Bearer ${s.token}` } });
  return ((await res.json()) as { balance: number }).balance;
};

/** The three E1 numbers of the plan: opening 100.00, cases 300 + 200 + 150, payments 120 (bound), 250, 60 (bound) → 320.00. */
async function seedE1(request: APIRequestContext, s: Seed) {
  const c1 = await newCase(request, s, 30000, '2026-11-01', `ليلى ${s.suffix}`);
  const c2 = await newCase(request, s, 20000, '2026-11-02', `رنا ${s.suffix}`);
  const c3 = await newCase(request, s, 15000, '2026-11-04', `سلمى ${s.suffix}`);
  await newPayment(request, s, { method: 'cash', amount: 12000, caseId: c2.id, paidAt: '2026-11-05' });
  await newPayment(request, s, { method: 'cash', amount: 25000, paidAt: '2026-11-05' });
  await newPayment(request, s, { method: 'transfer', amount: 6000, caseId: c3.id, paidAt: '2026-11-05' });
  return { c1, c2, c3 };
}

async function openBreakdown(page: Page, s: Seed, lang: 'ar' | 'en') {
  await page.goto(`/debts?q=${s.suffix}`);
  await page.getByRole('button', { name: s.doctor.name, exact: true }).click();
  return page.getByRole('dialog', { name: lang === 'ar' ? /تفاصيل ما على/ : /What .* owes/ });
}

/** The CSV a click produced: raw bytes, text without the BOM, parsed rows. */
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test('the breakdown ties out: equation = balance = doctor page, with its own URL (ar, axe)', async ({ page, request }) => {
  const s = await seed(request, 10000);
  await seedE1(request, s);
  expect(await balanceOf(request, s)).toBe(32000);
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');

  const dialog = await openBreakdown(page, s, 'ar');
  await expect(page).toHaveURL(new RegExp(`doctor=${s.doctor.id}`));
  await expect(dialog.getByTestId('breakdown-balance')).toContainText('320.00 ₪');
  const table = dialog.getByRole('table', { name: 'الحالات التي عليها مبلغ' });
  await expect(table.getByRole('row')).toHaveCount(4); // header + three open cases (the 100.00 opening is paid)
  await expect(table.getByRole('row').filter({ hasText: `ليلى ${s.suffix}` })).toContainText('150.00 ₪');
  await expect(table.getByRole('row').filter({ hasText: `رنا ${s.suffix}` })).toContainText('80.00 ₪');
  await expect(table.getByRole('row').filter({ hasText: `سلمى ${s.suffix}` })).toContainText('90.00 ₪');
  await expect(dialog.getByTestId('breakdown-tie')).toContainText('320.00 ₪');
  await expect(dialog.getByTestId('breakdown-equation')).toContainText('320.00 ₪');
  await expectAccessible(page);
  expect(await noSideways(page)).toBe(true);
  await shot(page, 'breakdown-ar', { fullPage: false });

  // The same number on the doctor page.
  await dialog.getByRole('link', { name: 'كشف الحساب', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/doctors/${s.doctor.id}/statement`));
  await expect(page.getByTestId('doctor-balance')).toContainText('320.00 ₪');
  await expect(page.getByTestId('statement-closing')).toContainText('320.00 ₪');

  // Back closes it; a reload of the address opens it again.
  await page.goBack();
  await expect(page.getByRole('dialog', { name: /تفاصيل ما على/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/doctor=/);
  await page.goto(`/debts?q=${s.suffix}&doctor=${s.doctor.id}`);
  await expect(page.getByTestId('breakdown-tie')).toContainText('320.00 ₪');
});

test('the breakdown in English: credit and opening lines, direction left to right (axe)', async ({ page, request }) => {
  const s = await seed(request, -5000);
  await newCase(request, s, 10000, '2026-11-01');
  await newPayment(request, s, { method: 'cash', amount: 3000 });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'en');
  expect(await balanceOf(request, s)).toBe(2000);
  const dialog = await openBreakdown(page, s, 'en');
  await expectDirection(page, 'en');
  await expect(dialog.getByTestId('breakdown-balance')).toContainText('20.00 ₪');
  await expect(dialog.locator('[data-row="credit"]')).toContainText('50.00 ₪');
  await expect(dialog.getByTestId('breakdown-tie')).toContainText('20.00 ₪');
  await expectAccessible(page);
  await shot(page, 'breakdown-en', { fullPage: false });
});

test('a doctor with many open cases pages inside the breakdown while the equation stays whole', async ({ page, request }) => {
  const s = await seed(request);
  for (let i = 1; i <= 12; i++) await newCase(request, s, 1000 * i, `2026-10-${String(i).padStart(2, '0')}`, `مريض ${i} ${s.suffix}`);
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  const dialog = await openBreakdown(page, s, 'ar');
  const total = (1 + 12) * 6 * 1000; // 78 000 minor = 780.00
  await expect(dialog.getByTestId('breakdown-tie')).toContainText(`${total / 100}.00 ₪`);
  const table = dialog.getByRole('table', { name: 'الحالات التي عليها مبلغ' });
  await expect(table.getByRole('row')).toHaveCount(11); // header + 10
  await dialog.getByRole('button', { name: /التالي|الصفحة التالية|2/ }).first().click();
  await expect(page).toHaveURL(/bp=2/);
  await expect(table.getByRole('row')).toHaveCount(3); // header + the last 2
  await expect(dialog.getByTestId('breakdown-tie')).toContainText(`${total / 100}.00 ₪`);
});

test('CSV: debts, breakdown, statement and payments download with BOM, Arabic headers and tie-out (ar)', async ({
  page,
  request,
}) => {
  const hostile = await seed(request, 0, '=SUM(1+1)');
  await newCase(request, hostile, 700, TODAY, '@evil');
  const s = await seed(request, 10000);
  await seedE1(request, s);
  await newPayment(request, s, {
    method: 'cheque',
    amount: 5000,
    cheque: { chequeNo: `CH-${s.suffix}`, bank: 'بنك فلسطين', dueDate: '2099-01-01' },
  });
  const balance = await balanceOf(request, s);
  expect(balance).toBe(32000);
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');

  // Debts: filtered by the search box, so only this doctor.
  await page.goto(`/debts?q=${s.suffix}`);
  let [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير CSV' }).click()]);
  let csv = await readDownload(download);
  expect([...csv.raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.name).toMatch(/^[a-z0-9-]+-debts-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.header).toEqual(['الطبيب', 'الاتجاه', 'المبلغ (ILS)', 'الرصيد (ILS)', 'شيكات قيد التحصيل (ILS)']);
  expect(csv.data).toEqual([[s.doctor.name, 'مستحق لي', '320.00', '320.00', '50.00']]);
  await expect(page.getByText(/تم حفظ الملف/)).toBeVisible();

  // A hostile name is neutralised in the file.
  await page.goto(`/debts?q=${hostile.suffix}`);
  [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير CSV' }).click()]);
  csv = await readDownload(download);
  expect(csv.data[0]?.[0]).toBe(`'${hostile.doctor.name}`);

  // Breakdown: the Remaining column sums to the balance (in minor units).
  const dialog = await openBreakdown(page, s, 'ar');
  [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'تصدير CSV' }).click()]);
  csv = await readDownload(download);
  expect(csv.header[7]).toBe('المتبقي (ILS)');
  const sum = csv.data.reduce((acc, r) => acc + BigInt((r[7] ?? '0').replace('.', '')), 0n);
  expect(Number(sum)).toBe(balance);
  expect(csv.data.filter((r) => r[0] === 'حالة')).toHaveLength(3);

  // Statement with a date range.
  await page.goto(`/doctors/${s.doctor.id}/statement?from=2026-11-03&to=2026-11-30`);
  [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير CSV' }).click()]);
  csv = await readDownload(download);
  expect(csv.data[0]).toEqual(['2026-11-03', 'رصيد افتتاحي للفترة', '', '', '', '', '600.00']);
  expect(csv.name).toContain(`statement-${s.doctor.id}-from-2026-11-03-to-2026-11-30`);
  expect(csv.data.at(-1)?.[6]).toBe('320.00');

  // Payments with the doctor filter.
  await page.goto(`/payments?doctor=${s.doctor.id}`);
  await expect(page.getByTestId('receipts-summary')).toBeVisible();
  [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير CSV' }).first().click()]);
  csv = await readDownload(download);
  expect(csv.header[0]).toBe('رقم السند');
  expect(csv.data).toHaveLength(4);
  expect(csv.data.some((r) => r[5] === `CH-${s.suffix}` && r[11] === 'لا')).toBe(true);
});

test('CSV headers follow the UI language (en)', async ({ page, request }) => {
  const s = await seed(request);
  await newCase(request, s, 12345, '2026-11-01');
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'en');
  await page.goto(`/debts?q=${s.suffix}`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csv = await readDownload(download);
  expect(csv.header).toEqual(['Doctor', 'Direction', 'Amount (ILS)', 'Balance (ILS)', 'Pending cheques (ILS)']);
  expect(csv.data).toEqual([[s.doctor.name, 'Owed to the lab', '123.45', '123.45', '0.00']]);
});

test('the export button says why it cannot export an empty list', async ({ page, request }) => {
  const s = await seed(request);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/debts?q=zzz${s.suffix}`);
  const button = page.getByRole('button', { name: 'تصدير CSV' });
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveAccessibleDescription('لا توجد بيانات للتصدير بهذه التصفية.');
});

test('receipts summary: counted by collection date and method, pending cheques and voids apart (ar, axe)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await newPayment(request, s, { method: 'cash', amount: 10000, paidAt: '2026-11-03' });
  await newPayment(request, s, { method: 'transfer', amount: 2500, paidAt: '2026-11-04' });
  const cheque = await newPayment(request, s, {
    method: 'cheque',
    amount: 4000,
    paidAt: '2026-10-20',
    cheque: { chequeNo: `S-${s.suffix}`, bank: 'B', dueDate: '2026-11-05' },
  });
  const cleared = await request.patch(`/api/v1/cheques/${cheque.payment.cheque!.id}/status`, {
    headers: { Authorization: `Bearer ${s.token}` },
    data: { rowVersion: cheque.payment.cheque!.rowVersion, status: 'cleared', statusDate: '2026-11-06' },
  });
  expect(cleared.status()).toBe(200);
  await newPayment(request, s, {
    method: 'cheque',
    amount: 900,
    paidAt: '2026-11-07',
    cheque: { chequeNo: `P-${s.suffix}`, bank: 'B', dueDate: '2099-12-05' },
  });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/payments?doctor=${s.doctor.id}&from=2026-11-01&to=2026-11-30`);
  const box = page.getByTestId('receipts-summary');
  // The cheque was paid in October but cleared on 2026-11-06, so it counts in November.
  await expect(box.getByTestId('receipts-counted')).toContainText('165.00 ₪');
  await expect(box.locator('[data-method="cash"]')).toContainText('100.00 ₪');
  await expect(box.locator('[data-method="transfer"]')).toContainText('25.00 ₪');
  await expect(box.locator('[data-method="cheque"]')).toContainText('40.00 ₪');
  await expect(box).toContainText('9.00 ₪'); // the pending cheque
  await expect(box).toContainText('حسب تاريخ التحصيل');
  await expectAccessible(page);
  await shot(page, 'receipts-summary-ar', { fullPage: false });
});

test('cases list shows paid / remaining equal to the case page; doctors list shows the balance (ar, axe)', async ({
  page,
  request,
}) => {
  const s = await seed(request, 2000);
  const c1 = await newCase(request, s, 30000, '2026-11-01', `أولى ${s.suffix}`);
  const c2 = await newCase(request, s, 20000, '2026-11-02', `ثانية ${s.suffix}`);
  await newPayment(request, s, { method: 'cash', amount: 25000 });
  await newPayment(request, s, { method: 'cash', amount: 5000, caseId: c2.id });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');

  await page.goto(`/cases?q=${s.suffix}`);
  const row = (caseNo: number) => page.getByRole('row').filter({ has: page.getByRole('link', { name: String(caseNo), exact: true }) });
  // 250.00 pool: the 20.00 opening first, then case 1 (230.00 of 300.00); case 2 got its own 50.00.
  await expect(row(c1.caseNo).locator('[data-figure="paid"]')).toContainText('230.00 ₪');
  await expect(row(c1.caseNo).locator('[data-figure="remaining"]')).toContainText('70.00 ₪');
  await expect(row(c2.caseNo).locator('[data-figure="paid"]')).toContainText('50.00 ₪');
  await expect(row(c2.caseNo).locator('[data-figure="remaining"]')).toContainText('150.00 ₪');
  await expectAccessible(page);
  await shot(page, 'cases-paid-remaining-ar', { fullPage: false });
  // The same numbers on the case page.
  await row(c1.caseNo).getByRole('link', { name: String(c1.caseNo), exact: true }).click();
  await expect(page.getByTestId('case-paid')).toContainText('230.00 ₪');

  await page.goto(`/doctors?q=${s.suffix}`);
  const doctorRow = page.getByRole('row').filter({ hasText: s.doctor.name });
  await expect(doctorRow.locator('[data-figure="balance"]')).toContainText('220.00 ₪'); // 20 + 300 + 200 − 300
  await expect(doctorRow.locator('[data-figure="balance"]')).toContainText('مستحق للمختبر');
  await expectAccessible(page);
  await shot(page, 'doctors-balance-ar', { fullPage: false });
  expect(await balanceOf(request, s)).toBe(22000);
});

test('global search: Ctrl+K, Arabic spelling variants, keyboard, vouchers, focus return (ar, axe)', async ({ page, request }) => {
  const s = await seed(request, 0, 'د. أحمد');
  const c = await newCase(request, s, 12000, TODAY, `ليلى ${s.suffix}`);
  const p = await newPayment(request, s, { method: 'cash', amount: 5000 });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/');

  const opener = page.getByRole('button', { name: /ابحث عن طبيب أو حالة/ });
  await expect(opener).toBeVisible(); // the shell (and its shortcut) is mounted
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'بحث' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox', { name: /ابحث في الأطباء/ });
  await expect(input).toBeFocused();
  // Typed without the hamza: still finds «د. أحمد …».
  await input.fill(`احمد ${s.suffix}`);
  const option = dialog.getByRole('option', { name: s.doctor.name, exact: true });
  await expect(option).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'search-ar', { fullPage: false });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/doctors/${s.doctor.id}$`));
  await expect(dialog).toHaveCount(0);

  // Esc returns the focus to the button.
  await opener.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();

  // A case by its number, and a voucher.
  await opener.click();
  await page.getByRole('combobox', { name: /ابحث في الأطباء/ }).fill(String(c.caseNo));
  await page.getByRole('option', { name: new RegExp(`الحالة ${c.caseNo}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${c.id}$`));
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: /ابحث في الأطباء/ }).fill(p.payment.voucherNo);
  await page.getByRole('option', { name: new RegExp(p.payment.voucherNo) }).click();
  await expect(page).toHaveURL(new RegExp(`/payments\\?q=${p.payment.voucherNo}`));
  await expect(page.getByRole('row').filter({ hasText: p.payment.voucherNo })).toBeVisible();
});

test('global search: nothing found says so; English, left to right (axe)', async ({ page, request }) => {
  const s = await seed(request, 0, 'Dr Smith');
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'en');
  await page.goto('/');
  await page.getByRole('button', { name: /Search for a doctor or a case/ }).click();
  const input = page.getByRole('combobox', { name: 'Search doctors, cases and payments' });
  await input.fill(`zzzz${s.suffix}`);
  await expect(page.getByTestId('search-empty')).toContainText('No results');
  await input.fill(`smith ${s.suffix}`);
  await expect(page.getByRole('option', { name: new RegExp(s.doctor.name) })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Doctors', { exact: true })).toBeVisible();
  await expectDirection(page, 'en');
  await expectAccessible(page);
  await shot(page, 'search-en', { fullPage: false });
});

test('narrow screens: the breakdown and the search dialogs fit the screen (ar)', async ({
  page,
  request,
}) => {
  const s = await seed(request, 10000);
  await seedE1(request, s);
  await page.setViewportSize({ width: 390, height: 800 });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/debts?q=${s.suffix}`);
  await expect(page.getByRole('button', { name: s.doctor.name, exact: true })).toBeVisible();
  // The lists themselves are wider than 390 px (pre-existing, production-readiness S14); the new dialogs must fit.
  const inside = async (dialog: ReturnType<Page['getByRole']>) => {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  };
  const dialog = await openBreakdown(page, s, 'ar');
  await expect(dialog.getByTestId('breakdown-tie')).toContainText('320.00 ₪');
  await inside(dialog);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'بحث' });
  await expect(search).toBeVisible();
  await inside(search);
});
