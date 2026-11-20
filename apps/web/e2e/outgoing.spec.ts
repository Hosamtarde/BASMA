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
  startEdge,
  uid,
} from './support';

/**
 * B4b stage 2 (SPEC §5.9, §5.10, §5.13, §10): outgoing payments, refunds to doctors, the expenses
 * report, the cash summary, the two-direction cheque register and search. Every test seeds its own
 * uniquely named doctor and expense category through the real API and is independent of the others.
 * Run with TZ=UTC.
 */
const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 800 };
const TODAY = new Date().toISOString().slice(0, 10);
const SOON = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

interface Seed {
  token: string;
  suffix: string;
  category: { id: number; name: string };
  refundCategoryId: number;
}
interface OutgoingBody {
  payment: { id: number; voucherNo: string; rowVersion: number; cheque: { id: number; rowVersion: number } | null };
  doctorBalance: number | null;
}
interface Doctor {
  id: number;
  name: string;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const category = await apiPost<{ id: number; name: string }>(request, token, '/expense-categories', {
    name: `إيجار ${suffix}`,
  });
  const list = (await (
    await request.get('/api/v1/expense-categories?pageSize=100', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { items: { id: number; isDoctor: boolean }[] };
  const refund = list.items.find((c) => c.isDoctor);
  expect(refund, 'the refund category exists').toBeDefined();
  return { token, suffix, category, refundCategoryId: refund!.id };
}

const expense = (request: APIRequestContext, s: Seed, body: Record<string, unknown>) =>
  apiPostKey<OutgoingBody>(request, s.token, '/outgoing-payments', {
    categoryId: s.category.id,
    payee: `مؤجّر ${s.suffix}`,
    method: 'cash',
    amount: 100000,
    ...body,
  });

async function newDoctor(request: APIRequestContext, s: Seed, prefix = 'د. سامي'): Promise<Doctor> {
  return apiPost<Doctor>(request, s.token, '/doctors', { name: `${prefix} ${s.suffix}` });
}

async function newCase(request: APIRequestContext, s: Seed, doctor: Doctor, price: number, receivedDate = TODAY) {
  const workType = await apiPost<{ id: number }>(request, s.token, '/work-types', {
    name: `تاج ${uid()}`,
    unitPrice: 40000,
  });
  return apiPost<{ id: number; caseNo: number }>(request, s.token, '/cases', {
    doctorId: doctor.id,
    patientName: `مريض ${s.suffix}`,
    receivedDate,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: workType.id, unitPrice: price }],
  });
}

const payIn = (request: APIRequestContext, s: Seed, doctor: Doctor, body: Record<string, unknown>) =>
  apiPostKey<{ payment: { id: number; voucherNo: string; cheque: { id: number; rowVersion: number } | null } }>(
    request,
    s.token,
    '/payments',
    { doctorId: doctor.id, ...body },
  );

const balanceOf = async (request: APIRequestContext, s: Seed, doctor: Doctor) =>
  (
    (await (
      await request.get(`/api/v1/doctors/${doctor.id}/balance`, { headers: { Authorization: `Bearer ${s.token}` } })
    ).json()) as { balance: number }
  ).balance;

async function setIncomingChequeStatus(request: APIRequestContext, s: Seed, chequeId: number, rowVersion: number, status: string, statusDate: string) {
  const res = await request.patch(`/api/v1/cheques/${chequeId}/status`, {
    headers: { Authorization: `Bearer ${s.token}` },
    data: { status, rowVersion, statusDate },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { payment: { cheque: { rowVersion: number } } };
}

const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/** The toast is gone and the mouse is away, so axe and screenshots see the page itself. */
async function settle(page: Page) {
  await page.mouse.move(5, 5);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
}

const formOf = (page: Page, lang: 'ar' | 'en') => page.getByRole('form', { name: lang === 'ar' ? 'مصروف جديد' : 'New expense' });

test('record an expense: numbered voucher, the table and the report follow, the CSV is read (ar, axe)', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'دفعة صادرة', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'دفعة صادرة', level: 1 })).toBeVisible();
  await expectDirection(page, 'ar');

  const form = formOf(page, 'ar');
  await form.getByRole('combobox', { name: /^الفئة/ }).selectOption({ label: s.category.name });
  await form.getByRole('textbox', { name: /^المدفوع له/ }).fill(`مؤجّر ${s.suffix}`);
  await form.getByRole('textbox', { name: /^المبلغ/ }).fill('1500.50');
  await expectAccessible(page);
  await form.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(page.getByText(/تم حفظ المصروف \u2066OUT-\d{6}\u2069\./)).toBeVisible();
  // The form starts blank again.
  await expect(form.getByRole('textbox', { name: /^المبلغ/ })).toHaveValue('');

  // The report of this category only: table, totals and summary agree.
  await page.goto(`/outgoing?category=${s.category.id}`);
  const table = page.getByRole('table', { name: 'تقرير المصاريف' });
  const row = table.getByRole('row').filter({ hasText: `مؤجّر ${s.suffix}` });
  await expect(row).toContainText('1,500.50 ₪');
  await expect(row).toContainText('نقدًا');
  await expect(row).toContainText('فعّالة');
  await expect(page.getByTestId('outgoing-totals')).toContainText('1,500.50 ₪');
  await expect(page.getByTestId('expenses-counted')).toHaveText('1,500.50 ₪');
  await expect(page.getByTestId('expenses-summary')).toContainText('حسب تاريخ الصرف');
  await expect(page.getByTestId('expenses-summary').locator(`[data-category="${s.category.id}"]`)).toContainText('1,500.50 ₪');
  await settle(page);
  await expectAccessible(page);
  await shot(page, 'outgoing-ar');

  // CSV of the list: BOM, Arabic header, one row for one expense, the voucher and the payee in it.
  const [list] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير المصاريف CSV' }).click()]);
  const csv = await readDownload(list);
  expect([...csv.raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.name).toMatch(/^[a-z0-9-]+-outgoing-payments-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.header[0]).toBe('رقم السند');
  expect(csv.header[3]).toBe('الفئة');
  expect(csv.data).toHaveLength(1);
  expect(csv.data[0]?.[0]).toMatch(/^OUT-\d{6}$/);
  expect(csv.data[0]?.[3]).toBe(s.category.name);
  expect(csv.data[0]?.[4]).toBe(`مؤجّر ${s.suffix}`);
  expect(csv.data[0]?.[9]).toBe('1500.50');

  // CSV by category.
  await page.mouse.move(5, 5);
  const [byCat] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير حسب الفئة CSV' }).click()]);
  const catCsv = await readDownload(byCat);
  expect(catCsv.name).toContain('expenses-by-category');
  expect(catCsv.data.some((r) => r[0] === s.category.name)).toBe(true);
});

test('the form says what is missing in Arabic and sends nothing; a post-dated cheque is accepted', async ({ page, request }) => {
  const s = await seed(request);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/outgoing?category=${s.category.id}`);
  const form = formOf(page, 'ar');
  await form.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(form.getByText('هذا الحقل مطلوب.').first()).toBeVisible();
  await form.getByRole('combobox', { name: /^الفئة/ }).selectOption({ label: s.category.name });
  await form.getByRole('radio', { name: 'شيك' }).check();
  await form.getByRole('textbox', { name: /^المبلغ/ }).fill('0');
  await form.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(form.getByText('اكتب اسم المدفوع له.')).toBeVisible();
  await expect(form.getByText('أدخل مبلغًا أكبر من صفر.')).toBeVisible();
  await expect(form.getByText('أدخل رقم الشيك.')).toBeVisible();
  await expect(form.getByText('أدخل اسم البنك.')).toBeVisible();
  const list = await request.get(`/api/v1/outgoing-payments?categoryId=${s.category.id}`, {
    headers: { Authorization: `Bearer ${s.token}` },
  });
  expect(((await list.json()) as { total: number }).total).toBe(0);

  // A due date later than today is fine for the lab's own cheque.
  await form.getByRole('textbox', { name: /^المدفوع له/ }).fill(`مورّد ${s.suffix}`);
  await form.getByRole('textbox', { name: /^المبلغ/ }).fill('800');
  await form.getByRole('textbox', { name: /^رقم الشيك/ }).fill(`CH-${s.suffix}`);
  await form.getByRole('textbox', { name: /^بنك المختبر/ }).fill('بنك القدس');
  await form.getByRole('textbox', { name: /^تاريخ الاستحقاق/ }).fill('2099-12-01');
  await form.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(page.getByText(/تم حفظ المصروف \u2066OUT-\d{6}\u2069\./)).toBeVisible();
  const row = page.getByRole('table', { name: 'تقرير المصاريف' }).getByRole('row').filter({ hasText: `مورّد ${s.suffix}` });
  await expect(row).toContainText('قيد التحصيل');
  await expect(row).toContainText('غير محتسب بعد');
});

test('an outgoing cheque counts in the report only once it is cleared in the register (ar)', async ({ page, request }) => {
  const s = await seed(request);
  const chequeNo = `CH-${s.suffix}`;
  await expense(request, s, {
    method: 'cheque',
    amount: 80000,
    cheque: { chequeNo, bank: 'بنك القدس', dueDate: SOON },
  });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');

  // Pending: counted 0.00, the cheque shows as pending money.
  await page.goto(`/outgoing?category=${s.category.id}`);
  await expect(page.getByTestId('expenses-counted')).toHaveText('0.00 ₪');
  await expect(page.getByTestId('outgoing-totals')).toContainText('800.00 ₪'); // the pending cheque, as a memo
  await expect(page.getByTestId('expenses-summary').getByText('شيكات صادرة قيد الصرف').first()).toBeVisible();

  // Clear it in the register (direction «صادرة»).
  await page.getByRole('link', { name: 'سجل الشيكات', exact: true }).click();
  await page.getByRole('searchbox', { name: 'ابحث برقم الشيك أو البنك أو الطبيب أو المدفوع له أو السند' }).fill(chequeNo);
  const row = page.getByRole('row').filter({ hasText: chequeNo });
  await expect(row).toContainText('صادرة');
  await expect(row).toContainText('يستحق قريبًا');
  await row.getByRole('button', { name: /^تغيير الحالة/ }).click();
  const dialog = page.getByRole('dialog', { name: `تغيير حالة الشيك \u2066${chequeNo}\u2069` });
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await dialog.getByLabel('الحالة الجديدة').selectOption('cleared');
  await dialog.getByRole('button', { name: 'حفظ الحالة' }).click();
  await expect(page.getByText(`أصبح الشيك \u2066${chequeNo}\u2069 «تم الصرف».`)).toBeVisible();
  await expect(row).toContainText('تم الصرف');

  // Counted now, on the day it cleared.
  await page.goto(`/outgoing?category=${s.category.id}`);
  await expect(page.getByTestId('expenses-counted')).toHaveText('800.00 ₪');
  await expect(page.getByRole('table', { name: 'تقرير المصاريف' }).getByRole('row').filter({ hasText: chequeNo })).toContainText('تم الصرف');
});

test('void with a reason: the expense stays listed, struck out, and stops counting (ar)', async ({ page, request }) => {
  const s = await seed(request);
  const p = await expense(request, s, { amount: 25000 });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/outgoing?q=${p.payment.voucherNo}`);
  await expect(page.getByTestId('expenses-counted')).toHaveText('250.00 ₪');
  const row = page.getByRole('row').filter({ hasText: p.payment.voucherNo });
  await row.getByRole('button', { name: `إلغاء الدفعة ${p.payment.voucherNo}` }).click();
  const dialog = page.getByRole('dialog', { name: `إلغاء الدفعة \u2066${p.payment.voucherNo}\u2069؟` });
  await dialog.getByRole('button', { name: 'إلغاء الدفعة', exact: true }).click();
  await expect(dialog.getByText('هذا الحقل مطلوب.')).toBeVisible();
  await dialog.getByRole('textbox', { name: /سبب الإلغاء/ }).fill('سُجّل مرتين');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'إلغاء الدفعة', exact: true }).click();
  await expect(page.getByText(`تم إلغاء الدفعة \u2066${p.payment.voucherNo}\u2069.`)).toBeVisible();
  await expect(row).toContainText('ملغاة: سُجّل مرتين');
  await expect(row.getByRole('button', { name: `إلغاء الدفعة ${p.payment.voucherNo}` })).toHaveAttribute('aria-disabled', 'true');
  // No longer counted: the summary shows 0.00 and keeps the payment as a cancelled one.
  await expect(page.getByTestId('expenses-counted')).toHaveText('0.00 ₪');
  await expect(page.getByTestId('expenses-summary')).toContainText('دفعات ملغاة');
});

test('refund a doctor’s credit from his page: balance 0, a statement line, the breakdown settled (ar + en dialog)', async ({ page, request }) => {
  const s = await seed(request);
  const doctor = await newDoctor(request, s);
  await newCase(request, s, doctor, 10000);
  await payIn(request, s, doctor, { method: 'cash', amount: 15000 });
  expect(await balanceOf(request, s, doctor)).toBe(-5000);
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');

  await page.goto(`/doctors/${doctor.id}`);
  const card = page.getByTestId('doctor-balance');
  await expect(card).toContainText('50.00 ₪');
  await expect(card).toContainText('مستحق على المختبر');
  await page.getByRole('button', { name: 'استرداد رصيد' }).click();
  const dialog = page.getByRole('dialog', { name: `استرداد رصيد إلى ${doctor.name}` });
  await expect(dialog.getByTestId('outgoing-refundable')).toContainText('50.00 ₪');
  // Over the credit: refused in the form, nothing is sent.
  await dialog.getByRole('textbox', { name: /^المبلغ/ }).fill('60');
  await dialog.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(dialog.getByText('المبلغ أكبر من الرصيد القابل للاسترداد (\u206650.00 ₪\u2069).')).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'refund-dialog-ar', { fullPage: false });
  await dialog.getByRole('textbox', { name: /^المبلغ/ }).fill('50');
  await dialog.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(page.getByText(/تم حفظ المصروف \u2066OUT-\d{6}\u2069 \(استرداد\)\. الرصيد الجديد: \u20660\.00 ₪\u2069\./)).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await balanceOf(request, s, doctor)).toBe(0);
  await expect(card).toContainText('مسدَّد');
  await expect(page.getByTestId('balance-paid-out')).toContainText('50.00 ₪');
  // Nothing left to refund: the action stays, disabled, with its reason.
  const action = page.getByRole('button', { name: 'استرداد رصيد' });
  await expect(action).toHaveAttribute('aria-disabled', 'true');
  await expect(action).toHaveAccessibleDescription('لا يوجد رصيد دائن للاسترداد.');

  // The statement shows the refund line and closes at zero.
  await page.getByRole('link', { name: 'كشف الحساب', exact: true }).click();
  const line = page.getByRole('row').filter({ hasText: 'استرداد للطبيب' });
  await expect(line).toContainText(/OUT-\d{6}/);
  await expect(line).toContainText('50.00 ₪');
  await expect(page.getByTestId('statement-closing')).toContainText('0.00 ₪');

  // The breakdown of a settled doctor says so.
  await page.goto(`/debts?doctor=${doctor.id}`);
  await expect(page.getByRole('dialog').getByText('لا يوجد مبلغ مستحق على هذا الطبيب.')).toBeVisible();
  await expect(page.getByRole('dialog').getByTestId('breakdown-paid-out')).toContainText('50.00 ₪');
});

test('R3: a refund and then his cheque returns — debts shows him owing, the refund has its own line in the breakdown (ar, axe)', async ({ page, request }) => {
  const s = await seed(request);
  const doctor = await newDoctor(request, s, 'د. رامي');
  await newCase(request, s, doctor, 20000, '2026-11-01');
  const cheque = await payIn(request, s, doctor, {
    method: 'cheque',
    amount: 30000,
    paidAt: '2026-11-02',
    cheque: { chequeNo: `K-${s.suffix}`, bank: 'بنك فلسطين', dueDate: '2026-11-03' },
  });
  const cleared = await setIncomingChequeStatus(request, s, cheque.payment.cheque!.id, cheque.payment.cheque!.rowVersion, 'cleared', '2026-11-03');
  expect(await balanceOf(request, s, doctor)).toBe(-10000);
  const refund = await apiPostKey<OutgoingBody>(request, s.token, '/outgoing-payments', {
    categoryId: s.refundCategoryId,
    doctorId: doctor.id,
    method: 'cash',
    amount: 10000,
    paidAt: '2026-11-05',
  });
  expect(refund.doctorBalance).toBe(0);
  await setIncomingChequeStatus(request, s, cheque.payment.cheque!.id, cleared.payment.cheque.rowVersion, 'returned', '2026-11-10');
  expect(await balanceOf(request, s, doctor)).toBe(30000);

  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/debts?q=${s.suffix}`);
  const debtRow = page.getByRole('row').filter({ hasText: doctor.name });
  await expect(debtRow).toContainText('300.00 ₪');
  await expect(debtRow).toContainText('مستحق لي');
  await page.getByRole('button', { name: doctor.name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /تفاصيل ما على/ });
  await expect(dialog.getByTestId('breakdown-balance')).toContainText('300.00 ₪');
  const refundLine = dialog.locator(`[data-refund="${refund.payment.voucherNo}"]`);
  await expect(refundLine).toContainText('استرداد للطبيب');
  await expect(refundLine).toContainText('2026-11-05');
  await expect(refundLine).toContainText('100.00 ₪');
  // 0 + 200.00 (the case) + 100.00 (the refund) − 0 = 300.00 = the balance.
  await expect(dialog.getByTestId('breakdown-refunds-remaining')).toContainText('100.00 ₪');
  await expect(dialog.getByTestId('breakdown-tie')).toContainText('300.00 ₪');
  await expect(dialog.getByTestId('breakdown-equation')).toContainText('متبقي الاسترداد');
  await expectAccessible(page);
  await shot(page, 'breakdown-refund-ar', { fullPage: false });
  expect(await noSideways(page)).toBe(true);
  await dialog.getByRole('link', { name: 'كشف الحساب' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'شيك مرتجع' })).toContainText('300.00 ₪');
  await expect(page.getByTestId('statement-closing')).toContainText('300.00 ₪');
});

test('the register filters by direction «صادرة» through the address: reload, back and forward keep it (ar)', async ({ page, request }) => {
  const s = await seed(request);
  const doctor = await newDoctor(request, s);
  await newCase(request, s, doctor, 40000);
  await payIn(request, s, doctor, {
    method: 'cheque',
    amount: 5000,
    cheque: { chequeNo: `IN-${s.suffix}`, bank: 'بنك فلسطين', dueDate: SOON },
  });
  await expense(request, s, { method: 'cheque', amount: 7000, cheque: { chequeNo: `OUT-${s.suffix}`, bank: 'بنك القدس', dueDate: SOON } });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/cheques?q=${s.suffix}`);
  await expect(page.getByRole('row').filter({ hasText: `IN-${s.suffix}` })).toContainText('واردة');
  await expect(page.getByRole('row').filter({ hasText: `OUT-${s.suffix}` })).toContainText('صادرة');
  const directions = page.getByRole('group', { name: 'اتجاه الشيك' });
  await expect(directions.getByRole('button', { name: /^الكل 2$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(directions.getByRole('button', { name: /^واردة 1$/ })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'cheques-register-ar');

  await directions.getByRole('button', { name: /^صادرة/ }).click();
  await expect(page).toHaveURL(/direction=out/);
  await expect(page.getByRole('row').filter({ hasText: `OUT-${s.suffix}` })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: `IN-${s.suffix}` })).toHaveCount(0);
  // The party of the lab's cheque is the payee, and its voucher opens the expenses page on it.
  await expect(page.getByRole('row').filter({ hasText: `OUT-${s.suffix}` })).toContainText(`مؤجّر ${s.suffix}`);
  await page.reload();
  await expect(directions.getByRole('button', { name: /^صادرة/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('row').filter({ hasText: `IN-${s.suffix}` })).toHaveCount(0);
  // Leave and come back: the filter changes replace the address, so Back returns to the filtered list.
  await page.getByRole('link', { name: 'الديون', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'الديون', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/direction=out/);
  await expect(directions.getByRole('button', { name: /^صادرة/ })).toHaveAttribute('aria-pressed', 'true');
  // «الكل» clears the choice from the address and brings the doctors' cheque back.
  await directions.getByRole('button', { name: /^الكل/ }).click();
  await expect(page).not.toHaveURL(/direction=/);
  await expect(page.getByRole('row').filter({ hasText: `IN-${s.suffix}` })).toBeVisible();
  await directions.getByRole('button', { name: /^صادرة/ }).click();
  await expect(page).toHaveURL(/direction=out/);
  await page.getByRole('row').filter({ hasText: `OUT-${s.suffix}` }).getByRole('link', { name: /^OUT-\d{6}$/ }).click();
  await expect(page).toHaveURL(/\/outgoing\?q=OUT-\d{6}/);
  await expect(page.getByRole('table', { name: 'تقرير المصاريف' }).getByRole('row').filter({ hasText: `مؤجّر ${s.suffix}` })).toBeVisible();
});

test('cash summary: money in and out of one day, and the net (ar)', async ({ page, request }) => {
  const s = await seed(request);
  const doctor = await newDoctor(request, s);
  const day = '2025-03-14'; // a day no other test uses
  await payIn(request, s, doctor, { method: 'cash', amount: 40000, paidAt: day });
  await expense(request, s, { method: 'cash', amount: 15000, paidAt: day });
  await page.setViewportSize(DESKTOP);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/outgoing?from=${day}&to=${day}`);
  const panel = page.getByTestId('cash-flow');
  await expect(panel.getByTestId('cash-in')).toContainText('400.00 ₪');
  await expect(panel.getByTestId('cash-out')).toContainText('150.00 ₪');
  await expect(panel.getByTestId('cash-net')).toContainText('250.00 ₪');
  await expect(panel).toContainText(day);
  await expect(page.getByTestId('expenses-counted')).toHaveText('150.00 ₪');
  await settle(page);
  await expectAccessible(page);
});

test('global search finds an outgoing payment by its OUT- voucher and opens the expenses page on it (ar)', async ({ page, request }) => {
  const s = await seed(request);
  const p = await expense(request, s, { amount: 12300 });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'ابحث في الأطباء والحالات والدفعات' }).fill(p.payment.voucherNo);
  const option = page.getByRole('option', { name: new RegExp(p.payment.voucherNo) });
  await expect(option).toBeVisible();
  await expect(page.getByTestId('global-search')).toContainText('المصاريف');
  await option.click();
  await expect(page).toHaveURL(new RegExp(`/outgoing\\?q=${p.payment.voucherNo}`));
  await expect(page.getByRole('row').filter({ hasText: p.payment.voucherNo })).toContainText('123.00 ₪');
});

test('English: the page, the register and the refund dialog are axe clean, laid out left to right with money at the end (en)', async ({ page, request }) => {
  const s = await seed(request);
  const doctor = await newDoctor(request, s);
  await newCase(request, s, doctor, 10000);
  await payIn(request, s, doctor, { method: 'cash', amount: 15000 });
  await expense(request, s, { amount: 123456 });
  await expense(request, s, { method: 'cheque', amount: 5000, cheque: { chequeNo: `EN-${s.suffix}`, bank: 'Quds Bank', dueDate: '2020-01-01' } });
  await page.setViewportSize(LAPTOP);
  await signedIn(page);
  await setLanguage(page, 'en');

  await page.getByRole('link', { name: 'Outgoing payment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outgoing payment', level: 1 })).toBeVisible();
  await expectDirection(page, 'en');
  await page.goto(`/outgoing?category=${s.category.id}`);
  const table = page.getByRole('table', { name: 'Expenses report' });
  const row = table.getByRole('row').filter({ hasText: '1,234.56' });
  await expect(row).toContainText('Cash');
  await expect(page.getByTestId('expenses-summary')).toContainText('By the day the money left');
  await expect(page.getByTestId('cash-flow')).toBeVisible();
  // Money sits at the reading end of its column, header and cell alike (English: the right edge).
  const th = table.getByRole('columnheader', { name: 'Amount', exact: true });
  const cell = row.getByRole('cell').nth(5);
  const right = (loc: typeof th) =>
    loc.evaluate((n) => {
      const r = document.createRange();
      r.selectNodeContents(n);
      return r.getBoundingClientRect().right;
    });
  expect(Math.abs((await right(th)) - (await right(cell)))).toBeLessThan(3);
  expect(await startEdge(row.getByRole('cell').first(), 'en')).toBeGreaterThan(0);
  expect(await noSideways(page)).toBe(true);
  await settle(page);
  await expectAccessible(page);
  await shot(page, 'outgoing-en');

  // The form in English, with the cheque fields open.
  const form = formOf(page, 'en');
  await form.getByRole('radio', { name: 'Cheque' }).check();
  await expect(form.getByRole('textbox', { name: /^Lab bank/ })).toBeVisible();
  await expectAccessible(page);

  // Register with direction chips.
  await page.getByRole('link', { name: 'Cheque register', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search cheque number, bank, doctor, payee or voucher' }).fill(`EN-${s.suffix}`);
  const chequeRow = page.getByRole('row').filter({ hasText: `EN-${s.suffix}` });
  await expect(chequeRow).toContainText('Outgoing');
  await expect(chequeRow).toContainText('Overdue');
  await expect(page.getByRole('group', { name: 'Cheque direction' }).getByRole('button', { name: /^Outgoing/ })).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  await settle(page);
  await expectAccessible(page);
  await shot(page, 'cheques-register-en');

  // The refund dialog in English.
  await page.goto(`/doctors/${doctor.id}`);
  await page.getByRole('button', { name: 'Refund credit' }).click();
  const dialog = page.getByRole('dialog', { name: `Refund credit to ${doctor.name}` });
  await expect(dialog.getByTestId('outgoing-refundable')).toContainText('50.00 ₪');
  await expectAccessible(page);
  await shot(page, 'refund-dialog-en', { fullPage: false });
  await page.keyboard.press('Escape');
  // Focus returns to the control that opened it.
  await expect(page.getByRole('button', { name: 'Refund credit' })).toBeFocused();
  await setLanguage(page, 'ar');
});
