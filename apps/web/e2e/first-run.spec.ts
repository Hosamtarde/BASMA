import { expect, test } from '@playwright/test';
import { AR, expectAccessible, expectDirection, shot, signIn, uid } from './support';

/**
 * Project "first-run": its own empty database (no owner). This file is the only one using it and
 * runs in order: the wizard, then what changes only once in an installation's life (the currency
 * lock after the first amount, the numbering lock after the first case, a password change).
 */
test.describe.configure({ mode: 'serial' });

const FIRST = { username: 'owner', password: 'first-pass-1234', newPassword: 'second-pass-5678' };
const LAB_AR = 'مختبر سمايل آرتك لتقنية الأسنان';

async function signedInFirst(page: import('@playwright/test').Page, password = FIRST.password) {
  await page.goto('/login');
  await signIn(page, FIRST.username, password, AR);
  await expect(page.getByRole('complementary')).toBeVisible();
}

test('the first visit opens the setup wizard in Arabic, right to left', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expectDirection(page, 'ar');
  await expect(page.getByRole('heading', { name: 'إعداد البرنامج لأول مرة' })).toBeVisible();
  await expect(page.getByText('من تطوير مختبر سمايل آرتك لتقنية الأسنان')).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'setup-ar');

  await page.getByRole('button', { name: /^English/ }).click();
  await expectDirection(page, 'en');
  await expect(page.getByRole('heading', { name: 'First-time setup' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'setup-en');
  await page.getByRole('button', { name: /^العربية/ }).click();
  await expectDirection(page, 'ar');
});

test('the wizard validates in the UI language before calling the API', async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('button', { name: 'إنشاء الحساب والبدء' }).click();
  await expect(page.getByText('هذا الحقل مطلوب.').first()).toBeVisible();
  await expect(page.getByText('اكتب اسم المختبر بالعربية أو بالإنجليزية.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'اسم المستخدم', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page).toHaveURL(/\/setup$/);
});

test('setup creates the owner and signs in automatically', async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('textbox', { name: 'اسم المستخدم', exact: true }).fill(FIRST.username);
  await page.getByRole('textbox', { name: 'كلمة المرور', exact: true }).fill(FIRST.password);
  await page.getByRole('textbox', { name: 'تأكيد كلمة المرور', exact: true }).fill(FIRST.password);
  await page.getByRole('textbox', { name: 'اسم المختبر بالعربية', exact: true }).fill(LAB_AR);
  await page.getByRole('textbox', { name: 'الهاتف', exact: true }).fill('02 222 3333');
  await expect(page.getByRole('textbox', { name: 'رمز العملة', exact: true })).toHaveValue('ILS');
  await page.getByRole('button', { name: 'إنشاء الحساب والبدء' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('complementary', { name: 'القائمة الجانبية' })).toContainText(LAB_AR);
  await expect(page.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
  // No vendor logo fallback: without an uploaded logo the sidebar shows the name only.
  await expect(page.getByRole('complementary').getByRole('img')).toHaveCount(0);
  await expectAccessible(page);
});

test('Home before the first case: a friendly empty state with a button to add the first case', async ({
  page,
}) => {
  await signedInFirst(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('heading', { level: 1, name: LAB_AR })).toBeVisible();
  const empty = page.getByRole('region', { name: 'لا توجد حالات بعد' });
  await expect(empty).toBeVisible();
  await expect(page.getByRole('region', { name: 'مسار الحالات' })).toHaveCount(0);
  // The three bottom panels stay, so the screen keeps its shape: zeros, a bare ring, a hint.
  const keyNumbers = page.getByRole('region', { name: 'الأرقام الرئيسية' });
  await expect(keyNumbers.getByRole('link', { name: 'الحالات 0', exact: true })).toBeVisible();
  await expect(keyNumbers.getByRole('link', { name: 'حالات متأخرة 0', exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'توزيع الحالات حسب المرحلة، المجموع 0', exact: true }),
  ).toBeVisible();
  await expect(page.locator('circle[data-status]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'آخر الحالات' })).toContainText(
    'ستظهر هنا الحالات التي تسجّلها.',
  );
  // No logo: the brand mark holds its place; no product name in the banner.
  const banner = page.getByRole('region', { name: LAB_AR });
  await expect(banner.locator('[data-banner-mark]')).toBeVisible();
  await expect(banner).not.toContainText('بسمة');
  await expect(banner).not.toContainText('Basma');
  // The action cards are there: two links, five «قريباً».
  const cards = page.getByRole('region', { name: 'ماذا تريد أن تسجّل؟' });
  await expect(cards.locator('a[href]')).toHaveCount(2);
  await expect(cards.locator('[aria-disabled="true"]')).toHaveCount(5);
  await expectAccessible(page);
  await shot(page, 'home-empty-ar', { fullPage: false });
  await page.getByRole('button', { name: /^English/ }).click();
  await expectDirection(page, 'en');
  await expect(page.getByRole('region', { name: 'No cases yet' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Key numbers' }).getByRole('link', { name: 'Cases 0', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Latest cases' })).toContainText(
    'Cases you record will appear here.',
  );
  await expectAccessible(page);
  await shot(page, 'home-empty-en', { fullPage: false });
  await page.getByRole('button', { name: /^العربية/ }).click();
  await expectDirection(page, 'ar');
  await empty.getByRole('link', { name: 'أضف أول حالة' }).click();
  await expect(page).toHaveURL(/\/cases\/new$/);
});

test('currency: editable while no amount exists, locked with an explanation after the first price', async ({
  page,
}) => {
  await signedInFirst(page);
  await page.getByRole('link', { name: 'الإعدادات' }).click();
  const code = page.getByRole('textbox', { name: 'رمز العملة', exact: true });
  await expect(code).toBeEnabled();
  await expect(page.getByText(/لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية \(المبالغ/)).toHaveCount(0);

  // The first amount in the installation: a work type with a price.
  await page.getByRole('link', { name: 'أنواع العمل' }).click();
  await page.getByRole('button', { name: 'إضافة نوع عمل' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'نوع العمل' }).fill(`زيركون ${uid()}`);
  await dialog.getByRole('textbox', { name: 'سعر السن الواحد' }).fill('250');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تمت إضافة نوع العمل.')).toBeVisible();

  await page.getByRole('link', { name: 'عام' }).click();
  await expect(code).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'عدد الخانات العشرية' })).toBeDisabled();
  await expect(page.getByText(/لذلك لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية/)).toBeVisible();
  // The symbol always stays editable.
  await expect(page.getByRole('textbox', { name: 'علامة العملة', exact: true })).toBeEnabled();
  await expectAccessible(page);
});

test('numbering: editable before the first case, locked with the next number after it', async ({
  page,
  request,
}) => {
  await signedInFirst(page);
  await page.getByRole('link', { name: 'الإعدادات' }).click();
  const caseStart = page.getByRole('textbox', { name: 'رقم أول حالة' });
  await caseStart.fill('500');
  const numbering = page.getByRole('form', { name: 'الترقيم' });
  await numbering.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.').first()).toBeVisible();

  // First case through the real API.
  const login = await request.post('/api/v1/auth/login', {
    data: { username: FIRST.username, password: FIRST.password },
  });
  const token = ((await login.json()) as { accessToken: string }).accessToken;
  const headers = { Authorization: `Bearer ${token}` };
  const doctor = await (
    await request.post('/api/v1/doctors', { headers, data: { name: `د. أول ${uid()}` } })
  ).json();
  const types = await (await request.get('/api/v1/work-types', { headers })).json();
  const created = await request.post('/api/v1/cases', {
    headers,
    data: {
      doctorId: doctor.id,
      patientName: 'مريض',
      expectedDate: '2099-01-01',
      lines: [{ workTypeId: types.items[0].id, toothNo: 11 }],
    },
  });
  expect(created.status()).toBe(201);
  expect((await created.json()).caseNo).toBe(500);

  await page.reload();
  await expect(caseStart).toBeDisabled();
  await expect(page.getByText(/صدر أول رقم، فلا يمكن تغيير البداية. الرقم التالي: 501/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'رقم أول فاتورة' })).toBeEnabled();
});

test('the password can be changed from the user menu', async ({ page }) => {
  await signedInFirst(page);
  await page.getByRole('button', { name: `قائمة المستخدم: ${FIRST.username}` }).click();
  await page.getByRole('menuitem', { name: 'تغيير كلمة المرور' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'كلمة المرور الحالية', exact: true }).fill(FIRST.password);
  await page.getByRole('textbox', { name: 'كلمة المرور الجديدة', exact: true }).fill(FIRST.newPassword);
  await page.getByRole('textbox', { name: 'تأكيد كلمة المرور الجديدة', exact: true }).fill(FIRST.newPassword);
  await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('تم تغيير كلمة المرور.')).toBeVisible();

  await page.context().clearCookies();
  await signedInFirst(page, FIRST.newPassword);
});
