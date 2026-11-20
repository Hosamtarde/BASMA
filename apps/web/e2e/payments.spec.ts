import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  apiPost,
  apiPostKey,
  apiToken,
  expectAccessible,
  expectDirection,
  setLanguage,
  shot,
  signedIn,
  startEdge,
  uid,
} from './support';

/**
 * B3 (SPEC §5.3, §5.8, §5.10, §5.11, §5.13): incoming payments, the cheque register, debts, the
 * doctor's statement, the case panel and the advance. Every test seeds its own uniquely named
 * doctor, work type and cases through the real API, and is independent of the others.
 */
const REPORT_SIZE = { width: 1440, height: 900 };
const TODAY = new Date().toISOString().slice(0, 10);
/** Three days ahead: «يستحق قريبًا» whichever time zone the lab and the test machine are in. */
const SOON = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

interface Seed {
  token: string;
  suffix: string;
  doctor: { id: number; name: string };
  workType: { id: number };
}
interface PaymentBody {
  payment: {
    id: number;
    voucherNo: string;
    rowVersion: number;
    cheque: { id: number; rowVersion: number } | null;
  };
  doctorBalance: number;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `تاج ${suffix}`,
    unitPrice: 40000,
  });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', {
    name: `د. سامي ${suffix}`,
  });
  return { token, suffix, doctor, workType };
}

const newCase = (request: APIRequestContext, s: Seed, price: number, receivedDate = TODAY) =>
  apiPost<{ id: number; caseNo: number; rowVersion: number }>(request, s.token, '/cases', {
    doctorId: s.doctor.id,
    patientName: `مريض ${s.suffix}`,
    receivedDate,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: s.workType.id, unitPrice: price }],
  });

const newPayment = (request: APIRequestContext, s: Seed, body: Record<string, unknown>) =>
  apiPostKey<PaymentBody>(request, s.token, '/payments', { doctorId: s.doctor.id, ...body });

async function pickDoctor(page: Page, label: string, name: string, search: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: search }).fill(name);
  await page.getByRole('option', { name }).click();
}

test('record a cash payment: the balance moves, the voucher is numbered, the page is axe clean (ar)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await newCase(request, s, 40000);
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'دفعة واردة', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'دفعة واردة', level: 1 })).toBeVisible();

  await pickDoctor(page, 'الطبيب', s.doctor.name, 'ابحث…');
  await expect(page.getByTestId('payment-balance')).toContainText('400.00 ₪');
  await page.getByRole('textbox', { name: 'المبلغ' }).fill('150.50');
  await expectAccessible(page);
  await shot(page, 'payments-ar');
  await page.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(page.getByText(/تم تسجيل الدفعة \u2066IN-\d{6}\u2069\. الرصيد الجديد: \u2066249\.50 ₪\u2069\./)).toBeVisible();
  await expect(page.getByTestId('payment-balance')).toContainText('249.50 ₪');

  // The report lists it, counted, and the totals follow.
  const row = page.getByRole('row').filter({ hasText: s.doctor.name }).first();
  await expect(row).toContainText('150.50 ₪');
  await expect(row).toContainText('نقدًا');
  await expect(row).toContainText('فعّالة');
});

test('amount and cheque fields are validated in Arabic and nothing is sent', async ({ page, request }) => {
  const s = await seed(request);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/payments');
  await pickDoctor(page, 'الطبيب', s.doctor.name, 'ابحث…');
  await page.getByRole('textbox', { name: 'المبلغ' }).fill('0');
  await page.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(page.getByText('أدخل مبلغًا أكبر من صفر.')).toBeVisible();
  await page.getByRole('radio', { name: 'شيك' }).check();
  await page.getByRole('textbox', { name: 'المبلغ' }).fill('10');
  await page.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(page.getByText('أدخل رقم الشيك.')).toBeVisible();
  await expect(page.getByText('أدخل اسم البنك.')).toBeVisible();
  await expect(page.getByText('أدخل تاريخ استحقاق الشيك.')).toBeVisible();
  const token = await apiToken(request);
  const list = await request.get(`/api/v1/payments?doctorId=${s.doctor.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(((await list.json()) as { total: number }).total).toBe(0);
});

test('a cheque counts only after it is cleared; a returned one restores the debt (register + doctor account)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const c = await newCase(request, s, 40000);
  await newPayment(request, s, {
    method: 'cheque',
    amount: 25000,
    caseId: c.id,
    cheque: { chequeNo: `CH-${s.suffix}`, bank: 'بنك فلسطين', dueDate: SOON },
  });
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');

  await page.goto(`/doctors/${s.doctor.id}`);
  await expect(page.getByTestId('doctor-balance')).toContainText('400.00 ₪');
  await expect(page.getByTestId('doctor-balance')).toContainText('شيكات قيد التحصيل');

  await page.getByRole('link', { name: 'سجل الشيكات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'سجل الشيكات', level: 1 })).toBeVisible();
  await page.getByRole('searchbox', { name: 'ابحث برقم الشيك أو البنك أو الطبيب أو المدفوع له أو السند' }).fill(`CH-${s.suffix}`);
  const row = page.getByRole('row').filter({ hasText: `CH-${s.suffix}` });
  await expect(row).toContainText('قيد التحصيل');
  await expect(row).toContainText('يستحق قريبًا');
  await expectAccessible(page);
  await shot(page, 'cheques-ar');

  await row.getByRole('button', { name: /^تغيير الحالة/ }).click();
  const dialog = page.getByRole('dialog', { name: `تغيير حالة الشيك \u2066CH-${s.suffix}\u2069` });
  await expect(dialog.getByRole('option')).toHaveCount(2); // cleared, returned — what the API allows
  await dialog.getByLabel('الحالة الجديدة').selectOption('cleared');
  await dialog.getByRole('button', { name: 'حفظ الحالة' }).click();
  await expect(page.getByText(`أصبح الشيك \u2066CH-${s.suffix}\u2069 «تم الصرف».`)).toBeVisible();
  await expect(row).toContainText('تم الصرف');

  await page.goto(`/doctors/${s.doctor.id}`);
  await expect(page.getByTestId('doctor-balance')).toContainText('150.00 ₪');

  // Cleared → returned is allowed; returned is final.
  await page.goto(`/cheques?q=CH-${s.suffix}`);
  await page.getByRole('row').filter({ hasText: `CH-${s.suffix}` }).getByRole('button', { name: /^تغيير الحالة/ }).click();
  const second = page.getByRole('dialog', { name: `تغيير حالة الشيك \u2066CH-${s.suffix}\u2069` });
  await expect(second.getByRole('option')).toHaveCount(1);
  await second.getByRole('button', { name: 'حفظ الحالة' }).click();
  await expect(page.getByText(`أصبح الشيك \u2066CH-${s.suffix}\u2069 «مرتجع».`)).toBeVisible();
  const done = page.getByRole('row').filter({ hasText: `CH-${s.suffix}` }).getByRole('button', { name: /^تغيير الحالة/ });
  await expect(done).toHaveAttribute('aria-disabled', 'true');
  await page.goto(`/doctors/${s.doctor.id}`);
  await expect(page.getByTestId('doctor-balance')).toContainText('400.00 ₪');
});

test('cancel a payment with a reason: it stays listed, struck out, and the balance returns (ar)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await newCase(request, s, 40000);
  const p = await newPayment(request, s, { method: 'transfer', amount: 10000 });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/payments?q=${p.payment.voucherNo}`);
  const row = page.getByRole('row').filter({ hasText: p.payment.voucherNo });
  await row.getByRole('button', { name: `إلغاء الدفعة ${p.payment.voucherNo}` }).click();
  const dialog = page.getByRole('dialog', { name: `إلغاء الدفعة \u2066${p.payment.voucherNo}\u2069؟` });
  await dialog.getByRole('button', { name: 'إلغاء الدفعة', exact: true }).click();
  await expect(dialog.getByText('هذا الحقل مطلوب.')).toBeVisible();
  await dialog.getByRole('textbox', { name: /سبب الإلغاء/ }).fill('سُجّلت مرتين');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'إلغاء الدفعة', exact: true }).click();
  await expect(page.getByText(`تم إلغاء الدفعة \u2066${p.payment.voucherNo}\u2069.`)).toBeVisible();
  await expect(row).toContainText('ملغاة: سُجّلت مرتين');
  await expect(row.getByRole('button', { name: `إلغاء الدفعة ${p.payment.voucherNo}` })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.goto(`/doctors/${s.doctor.id}`);
  await expect(page.getByTestId('doctor-balance')).toContainText('400.00 ₪');
});

test('the payments filters live in the address: reload, back and forward keep them', async ({ page, request }) => {
  const s = await seed(request);
  await newPayment(request, s, { method: 'cash', amount: 1000 });
  await newPayment(request, s, { method: 'transfer', amount: 2000 });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/payments');
  await page.getByRole('searchbox', { name: 'ابحث برقم السند أو الطبيب أو رقم الشيك' }).fill(s.suffix);
  await expect(page).toHaveURL(new RegExp(`q=${s.suffix}`));
  await page.getByLabel('الطريقة').selectOption('transfer');
  await expect(page).toHaveURL(/method=transfer/);
  const table = page.getByRole('table', { name: 'تقرير المقبوضات' });
  await expect(table.getByRole('row')).toHaveCount(2); // header + the transfer
  await page.reload();
  await expect(page.getByLabel('الطريقة')).toHaveValue('transfer');
  await expect(table.getByRole('row')).toHaveCount(2);
  // Leave and come back: the filter changes replace the address, so Back returns to the filtered list.
  await page.getByRole('link', { name: 'سجل الشيكات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'سجل الشيكات', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('الطريقة')).toHaveValue('transfer');
  await expect(page).toHaveURL(/method=transfer/);
  await page.getByLabel('الطريقة').selectOption('');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(page.getByTestId('payment-totals')).toContainText('30.00 ₪');
});

test('debts: the figures tie to the doctor account; the row links to his statement (ar, axe)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await newCase(request, s, 40000, '2026-11-01');
  await newCase(request, s, 30000, '2026-11-03');
  await newPayment(request, s, { method: 'cash', amount: 50000, paidAt: '2026-11-05' });
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'الديون', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'الديون', level: 1 })).toBeVisible();
  await page.getByRole('searchbox', { name: 'ابحث عن طبيب' }).fill(s.suffix);
  const row = page.getByRole('row').filter({ hasText: s.doctor.name });
  await expect(row).toContainText('200.00 ₪');
  await expect(row).toContainText('مستحق لي');
  await expectAccessible(page);
  await shot(page, 'debts-ar');
  await page.getByRole('button', { name: 'مستحق عليّ', exact: true }).click();
  await expect(page.getByText('لا يوجد طبيب يطابق البحث.')).toBeVisible();
  await page.getByRole('button', { name: 'الكل', exact: true }).click();

  // B4: the name opens the breakdown (see b4.spec.ts); the statement stays one click away in the row.
  await row.getByRole('link', { name: `كشف حساب ${s.doctor.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/doctors/${s.doctor.id}/statement`));
  await expect(page.getByTestId('doctor-balance')).toContainText('200.00 ₪');
  const statement = page.getByRole('table', { name: new RegExp('كشف حساب') });
  await expect(statement.getByRole('row')).toHaveCount(4); // header, two cases, the payment
  await expect(page.getByTestId('statement-closing')).toContainText('200.00 ₪');
  await expect(page.getByTestId('statement-opening')).toContainText('0.00 ₪');
  await expectAccessible(page);
  await shot(page, 'statement-ar');
  // A date range starts from the balance just before it.
  await page.getByRole('textbox', { name: 'من' }).fill('20261104');
  await expect(page.getByTestId('statement-opening')).toContainText('700.00 ₪');
});

test('the case panel shows paid and remaining; a payment from the case page is bound to it (ar)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const c = await newCase(request, s, 40000);
  await newPayment(request, s, { method: 'cash', amount: 10000, caseId: c.id });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/cases/${c.id}`);
  await expect(page.getByTestId('case-paid')).toContainText('100.00 ₪');
  await expect(page.getByTestId('case-remaining')).toContainText('300.00 ₪');
  await page.getByRole('button', { name: 'دفعة واردة لهذه الحالة' }).click();
  const dialog = page.getByRole('dialog', { name: `دفعة للحالة ${c.caseNo}` });
  await dialog.getByRole('textbox', { name: 'المبلغ' }).fill('300.01');
  await dialog.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  // More than what is left on the case: the server refuses, in its own words, inside the dialog.
  await expect(dialog.getByRole('alert')).toContainText('أكبر من المتبقي');
  await dialog.getByRole('textbox', { name: 'المبلغ' }).fill('300');
  await dialog.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('case-paid')).toContainText('400.00 ₪');
  await expect(page.getByTestId('case-remaining')).toContainText('0.00 ₪');
  await expectAccessible(page);
  await shot(page, 'case-payments-ar');
});

test('add a case with an advance payment in one step (ar)', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/cases/new');
  await pickDoctor(page, 'الطبيب', s.doctor.name, 'ابحث…');
  await page.getByRole('textbox', { name: 'اسم المريض' }).fill(`ليلى ${s.suffix}`);
  const chart = page.getByRole('group', { name: 'مخطط الأسنان' });
  await chart.getByRole('checkbox', { name: 'سن 13، ناب علوي يمين' }).click();
  await page.getByRole('combobox', { name: 'نوع العمل', exact: true }).click();
  await page.getByRole('combobox', { name: 'ابحث…' }).fill(`تاج ${s.suffix}`);
  await page.getByRole('option', { name: new RegExp(`تاج ${s.suffix}`) }).click();
  await page.getByRole('button', { name: 'إضافة العمل للأسنان المحددة (1)' }).click();
  await page.getByRole('textbox', { name: 'التسليم المتوقع' }).fill('20991231');

  await page.getByRole('textbox', { name: 'مبلغ الدفعة المقدمة' }).fill('500');
  await page.getByRole('button', { name: 'حفظ الحالة' }).click();
  await expect(page.getByText('الدفعة المقدمة لا يمكن أن تتجاوز إجمالي الحالة.')).toBeVisible();
  await page.getByRole('textbox', { name: 'مبلغ الدفعة المقدمة' }).fill('150');
  await page.getByRole('textbox', { name: 'مبلغ الدفعة المقدمة' }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.getByRole('textbox', { name: 'مبلغ الدفعة المقدمة' })).toBeInViewport();
  await expectAccessible(page);
  await shot(page, 'new-case-advance-ar', { fullPage: false });
  await page.getByRole('button', { name: 'حفظ الحالة' }).click();
  await expect(page.getByText(/تم تسجيل الدفعة المقدمة \u2066IN-\d{6}\u2069\./).first()).toBeVisible();
  await page.getByRole('link', { name: 'فتح الحالة' }).click();
  await expect(page.getByTestId('case-paid')).toContainText('150.00 ₪');
  await expect(page.getByTestId('case-remaining')).toContainText('250.00 ₪');
});

test('Payments, Cheques and Debts in English: direction, alignment of money columns, axe', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await newCase(request, s, 40000);
  await newPayment(request, s, { method: 'cash', amount: 12345 });
  await newPayment(request, s, {
    method: 'cheque',
    amount: 500,
    cheque: { chequeNo: `EN-${s.suffix}`, bank: 'Arab Bank', dueDate: '2020-01-01' },
  });
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'en');
  for (const [link, heading, name] of [
    ['Incoming payment', 'Incoming payment', 'payments-en'],
    ['Cheque register', 'Cheque register', 'cheques-en'],
    ['Debts', 'Debts', 'debts-en'],
  ] as const) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectDirection(page, 'en');
    await expectAccessible(page);
    await shot(page, name);
  }
  // Money sits at the reading end of its column, header and cell alike (English: right edge).
  await page.goto(`/cheques?q=EN-${s.suffix}`);
  const row = page.getByRole('row').filter({ hasText: `EN-${s.suffix}` });
  await expect(row).toContainText('Overdue');
  const th = page.getByRole('columnheader', { name: 'Amount', exact: true });
  // Columns: cheque, bank, direction, party, amount (B4b added the direction and the party).
  const cell = row.getByRole('cell').nth(4);
  const edge = (loc: typeof th) =>
    loc.evaluate((n) => {
      const r = document.createRange();
      r.selectNodeContents(n);
      return r.getBoundingClientRect().right;
    });
  expect(Math.abs((await edge(th)) - (await edge(cell)))).toBeLessThan(3);
  expect(await startEdge(row.getByRole('cell').first(), 'en')).toBeGreaterThan(0);
  // No sideways page scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The language is per installation: leave it as other tests expect it.
  await setLanguage(page, 'ar');
});
