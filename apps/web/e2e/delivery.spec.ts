import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiPost, apiPostKey, apiToken, expectAccessible, setLanguage, shot, signedIn, uid } from './support';

/**
 * B5 (SPEC §5.7, §5.16): delivering a case with the money question, its collect date, and the
 * notifications bell. Each test seeds its own doctor and cases through the real API. The bell lists
 * the whole installation's feed, so a test looks for the items of its own cases only.
 */
const REPORT_SIZE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

interface Seed {
  token: string;
  suffix: string;
  doctor: { id: number; name: string };
  workType: { id: number };
}
interface Case {
  id: number;
  caseNo: number;
  rowVersion: number;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `تاج تسليم ${suffix}`,
    unitPrice: 30000,
  });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', {
    name: `د. تسليم ${suffix}`,
  });
  return { token, suffix, doctor, workType };
}

const newCase = (request: APIRequestContext, s: Seed, status = 'ready') =>
  apiPost<Case>(request, s.token, '/cases', {
    doctorId: s.doctor.id,
    patientName: `مريض ${s.suffix}`,
    expectedDate: '2099-12-31',
    status,
    lines: [{ toothNo: 11, workTypeId: s.workType.id }],
  });

/** The lab's today, from the API (the browser and the test machine may be in another zone). */
async function labToday(request: APIRequestContext, s: Seed): Promise<string> {
  const res = await request.get('/api/v1/notifications/count', { headers: { Authorization: `Bearer ${s.token}` } });
  expect(res.status()).toBe(200);
  const feed = await request.get('/api/v1/notifications?limit=1', { headers: { Authorization: `Bearer ${s.token}` } });
  return ((await feed.json()) as { today: string }).today;
}

const plusDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function openDelivery(page: Page, c: Case) {
  await page.goto(`/cases/${c.id}`);
  await page.getByRole('button', { name: 'تسليم الحالة' }).click();
  return page.getByRole('dialog', { name: `تسليم الحالة رقم ${c.caseNo}` });
}

test('deliver with part of the money and a collect date: the case and the statement follow (ar, axe, 390 px)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const c = await newCase(request, s);
  const today = await labToday(request, s);
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');

  const dialog = await openDelivery(page, c);
  await expect(dialog.getByTestId('delivery-due')).toContainText('300.00 ₪');
  await dialog.getByRole('radio', { name: 'جزءًا من المبلغ' }).check();
  await dialog.getByRole('textbox', { name: /^المبلغ المستلَم/ }).fill('120');
  await dialog.getByRole('textbox', { name: 'موعد تحصيل الباقي' }).fill(plusDays(today, 10));
  await expectAccessible(page);
  await shot(page, 'delivery-partial-ar', { fullPage: false });
  await page.setViewportSize(PHONE);
  await expectAccessible(page);
  await shot(page, 'delivery-partial-ar-390', { fullPage: false });
  await page.setViewportSize(REPORT_SIZE);

  await dialog.getByRole('button', { name: 'تسليم الحالة' }).click();
  await expect(page.getByText(new RegExp(`تم تسليم الحالة رقم ${c.caseNo} وتسجيل الدفعة IN-\\d{6}\\. الرصيد الجديد: 180\\.00 ₪\\.`))).toBeVisible();
  await expect(dialog).toBeHidden();
  const header = page.getByRole('heading', { level: 1 }).locator('..');
  await expect(header).toContainText('تم التسليم');
  await expect(page.getByText(plusDays(today, 10))).toBeVisible();
  // «تسليم الحالة» stays visible, disabled, with the reason.
  const again = page.getByRole('button', { name: 'تسليم الحالة' });
  await expect(again).toHaveAttribute('aria-disabled', 'true');

  // The doctor's statement: the case and the payment taken at delivery.
  await page.goto(`/doctors/${s.doctor.id}/statement`);
  await expect(page.getByTestId('statement-closing')).toContainText('180.00 ₪');
});

test('the status dialog hands «تم التسليم» to the delivery dialog; Esc returns the focus (en, axe)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const c = await newCase(request, s, 'in_progress');
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'en');
  await page.goto(`/cases/${c.id}`);
  await page.getByRole('button', { name: 'Change status' }).click();
  const status = page.getByRole('dialog', { name: 'Change the case status' });
  await status.getByRole('radio', { name: 'Delivered' }).check();
  await expect(status.getByRole('note')).toContainText('Delivery is a step of its own');
  await status.getByRole('button', { name: 'Continue to delivery' }).click();
  const deliver = page.getByRole('dialog', { name: `Deliver case ${c.caseNo}` });
  await expect(deliver.getByTestId('delivery-due')).toContainText('300.00 ₪');
  await deliver.getByRole('radio', { name: 'Yes, in full (300.00 ₪)' }).check();
  await expectAccessible(page);
  await shot(page, 'delivery-full-en', { fullPage: false });
  await page.keyboard.press('Escape');
  await expect(deliver).toBeHidden();

  // From the page button, Esc gives the focus back to it.
  const button = page.getByRole('button', { name: 'Deliver case' });
  await button.click();
  await expect(deliver).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deliver).toBeHidden();
  await expect(button).toBeFocused();
  await setLanguage(page, 'ar');
});

test('deliver with a cheque: the register lists it pending and the bell counts it', async ({ page, request }) => {
  const s = await seed(request);
  const c = await newCase(request, s);
  const today = await labToday(request, s);
  const headers = { Authorization: `Bearer ${s.token}` };
  // Everything already in the feed is read, so the badge counts only what this test adds.
  await request.patch('/api/v1/notifications/state', { headers, data: { all: true, seen: true } });
  const before = ((await (await request.get('/api/v1/notifications/count', { headers })).json()) as { unread: number }).unread;

  await signedIn(page);
  await setLanguage(page, 'ar');
  const dialog = await openDelivery(page, c);
  await dialog.getByRole('radio', { name: 'نعم، المبلغ كاملًا (300.00 ₪)' }).check();
  await dialog.getByRole('radio', { name: 'شيك' }).check();
  await dialog.getByRole('textbox', { name: 'رقم الشيك' }).fill(`DL-${s.suffix}`);
  await dialog.getByRole('textbox', { name: 'البنك' }).fill('بنك فلسطين');
  await dialog.getByRole('textbox', { name: 'تاريخ الاستحقاق' }).fill(plusDays(today, 3));
  await dialog.getByRole('button', { name: 'تسليم الحالة' }).click();
  await expect(page.getByText(/وتسجيل الدفعة IN-\d{6}/)).toBeVisible();

  await page.goto(`/cheques?q=DL-${s.suffix}`);
  const row = page.getByRole('row').filter({ hasText: `DL-${s.suffix}` });
  await expect(row).toContainText('قيد التحصيل');
  await expect(row).toContainText('يستحق قريبًا');
  const after = ((await (await request.get('/api/v1/notifications/count', { headers })).json()) as { unread: number }).unread;
  expect(after).toBe(before + 1);
  // The bell polls; a reload shows the new badge at once.
  await page.reload();
  await expect(page.getByTestId('bell-badge')).toHaveText(after > 99 ? '99+' : String(after));
});

test('nothing received, collect date today: «تحصيل مستحق» in the bell; hide it; return and deliver again (ar + en, axe)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const c = await newCase(request, s);
  const today = await labToday(request, s);
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');

  const dialog = await openDelivery(page, c);
  await dialog.getByRole('radio', { name: 'لا، لم أستلم شيئًا' }).check();
  await expect(dialog.getByRole('radio', { name: 'نقدًا' })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'موعد تحصيل الباقي' }).fill(today);
  await dialog.getByRole('button', { name: 'تسليم الحالة' }).click();
  await expect(page.getByText(`تم تسليم الحالة رقم ${c.caseNo}.`)).toBeVisible();
  await expect(page.getByText('تحصيل مستحق').first()).toBeVisible();

  // The bell: the collect reminder of this case.
  await page.reload();
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  const panel = page.getByRole('dialog', { name: 'الإشعارات' });
  const group = panel.getByRole('region', { name: /^تحصيل مستحق/ });
  const item = group.getByRole('listitem').filter({ hasText: `الحالة رقم ${c.caseNo} ` });
  await expect(item).toContainText(/الباقي ⁦?300\.00 ₪/);
  await expect(item).toContainText('حان موعده');
  await expect(item.getByRole('link')).toHaveAttribute('href', `/cases/${c.id}`);
  await page.mouse.move(10, 890);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
  await expectAccessible(page);
  await shot(page, 'bell-ar', { fullPage: false });
  await page.setViewportSize(PHONE);
  await expectAccessible(page);
  await shot(page, 'bell-ar-390', { fullPage: false });
  await page.setViewportSize(REPORT_SIZE);

  // «إخفاء»: gone from the panel (and it stays gone until its date changes).
  await item.getByRole('button', { name: /^إخفاء: / }).click();
  await expect(item).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: /^الإشعارات/ })).toBeFocused();

  // English panel.
  await setLanguage(page, 'en');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const enPanel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(enPanel.getByRole('heading', { name: 'Notifications', level: 2 })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'bell-en', { fullPage: false });
  await page.keyboard.press('Escape');

  // Return to the lab: the collect date goes; deliver again with the money in full.
  await page.goto(`/cases/${c.id}`);
  await page.getByRole('button', { name: 'Change status' }).click();
  const status = page.getByRole('dialog', { name: 'Change the case status' });
  await status.getByRole('radio', { name: 'Returned for changes' }).check();
  await status.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('Returned for changes');
  await expect(page.getByText('Collection due')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deliver case' }).click();
  const again = page.getByRole('dialog', { name: `Deliver case ${c.caseNo}` });
  await again.getByRole('radio', { name: 'Yes, in full (300.00 ₪)' }).check();
  await again.getByRole('radio', { name: 'Cash' }).check();
  await again.getByRole('button', { name: 'Deliver case' }).click();
  await expect(page.getByText(new RegExp(`Case ${c.caseNo} delivered and payment IN-\\d{6} recorded`))).toBeVisible();
  await setLanguage(page, 'ar');

  const res = await request.get(`/api/v1/cases/${c.id}`, { headers: { Authorization: `Bearer ${s.token}` } });
  expect(await res.json()).toMatchObject({ status: 'delivered', remaining: 0, collectOn: null, collectDue: false });
});

test('the row menu offers «تسليم الحالة» for a case the API allows to deliver', async ({ page, request }) => {
  const s = await seed(request);
  const c = await newCase(request, s, 'design');
  // Already paid in full: the dialog delivers without the money question.
  await apiPostKey(request, s.token, '/payments', { doctorId: s.doctor.id, caseId: c.id, method: 'cash', amount: 30000 });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/cases?q=${s.suffix}`);
  await page.getByRole('button', { name: `إجراءات أخرى للحالة ${c.caseNo}` }).click();
  await page.getByRole('menuitem', { name: 'تسليم الحالة' }).click();
  const dialog = page.getByRole('dialog', { name: `تسليم الحالة رقم ${c.caseNo}` });
  await expect(dialog.getByTestId('delivery-due')).toContainText('الحالة مدفوعة بالكامل');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'تسليم الحالة' }).click();
  await expect(page.getByText(`تم تسليم الحالة رقم ${c.caseNo}.`)).toBeVisible();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: String(c.caseNo), exact: true }) });
  await expect(row).toContainText('تم التسليم');
});
