import { expect, test } from '@playwright/test';
import { AR, EN, expectAccessible, expectDirection, LAB_AR, OWNER, shot, signedIn, signIn } from './support';

/**
 * F0 end to end on a fresh database: first-run setup → automatic sign-in → session restored
 * after a reload → language switch saved for the installation → sign out / sign in → password
 * change. Runs in order (one installation, one owner).
 */
test.describe.configure({ mode: 'serial' });
test('the first visit opens the setup wizard in Arabic, right to left', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expectDirection(page, 'ar');
  await expect(page.getByRole('heading', { name: 'إعداد البرنامج لأول مرة' })).toBeVisible();
  await expect(page.getByText('من تطوير مختبر سمايل آرتك لتقنية الأسنان')).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'setup-ar');

  await page.getByRole('button', { name: 'تغيير اللغة إلى الإنجليزية' }).click();
  await expectDirection(page, 'en');
  await expect(page.getByRole('heading', { name: 'First-time setup' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'setup-en');
  await page.getByRole('button', { name: 'Change the language to Arabic' }).click();
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
  await page.getByRole('textbox', { name: 'اسم المستخدم', exact: true }).fill(OWNER.username);
  await page.getByRole('textbox', { name: 'كلمة المرور', exact: true }).fill(OWNER.password);
  await page.getByRole('textbox', { name: 'تأكيد كلمة المرور', exact: true }).fill(OWNER.password);
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
  await shot(page, 'shell-ar');
});

test('a reload restores the session from the httpOnly cookie; no token is stored', async ({
  page,
  context,
}) => {
  await signedIn(page, OWNER.password);
  await expect(page.getByRole('complementary')).toContainText(LAB_AR);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('complementary')).toContainText(LAB_AR);

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    visibleCookies: document.cookie,
  }));
  // Only the language choice may be kept in the browser; no token anywhere a script can read.
  expect(storage.local.filter((k) => k !== 'dentallab.language')).toEqual([]);
  expect(storage.session).toEqual([]);
  expect(storage.visibleCookies).toBe('');
  const refresh = (await context.cookies()).find((c) => c.name === 'refresh_token');
  expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth', secure: false });
});

test('the language switch flips the page in place and is saved for the installation', async ({ page }) => {
  await signedIn(page, OWNER.password);
  await page.getByRole('button', { name: 'English' }).click();
  await expectDirection(page, 'en');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByText('Welcome to')).toBeVisible();

  await page.reload();
  await expectDirection(page, 'en');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'shell-en');
});

test('sign out, a localized error for a wrong password, then sign in again', async ({ page }) => {
  await signedIn(page, OWNER.password);
  // The installation's saved language (English, from the previous test) applies after sign-in.
  await expectDirection(page, 'en');
  await page.getByRole('button', { name: `User menu: ${OWNER.username}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expectDirection(page, 'en');
  await expectAccessible(page);
  await shot(page, 'login-en');

  await signIn(page, OWNER.username, 'not-the-password', EN);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: 'العربية' }).click();
  await expectDirection(page, 'ar');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'login-ar');

  await signIn(page, OWNER.username, OWNER.password, AR);
  await expect(page).toHaveURL(/\/$/);
  // A language picked on the login page wins after sign-in and is saved for the installation.
  await expect(page.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
  await expectDirection(page, 'ar');
  await page.reload();
  await expectDirection(page, 'ar');
});

// The installation language is Arabic again after the previous test.
test('the password can be changed from the user menu', async ({ page }) => {
  await signedIn(page, OWNER.password);
  await page.getByRole('button', { name: `قائمة المستخدم: ${OWNER.username}` }).click();
  await page.getByRole('menuitem', { name: 'تغيير كلمة المرور' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await expectAccessible(page);
  await page.getByRole('textbox', { name: 'كلمة المرور الحالية', exact: true }).fill(OWNER.password);
  await page.getByRole('textbox', { name: 'كلمة المرور الجديدة', exact: true }).fill(OWNER.newPassword);
  await page.getByRole('textbox', { name: 'تأكيد كلمة المرور الجديدة', exact: true }).fill(OWNER.newPassword);
  await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('تم تغيير كلمة المرور.')).toBeVisible();
});

test('an unknown address shows the not-found page inside the shell', async ({ page }) => {
  await signedIn(page, OWNER.newPassword);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible();
  await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
  await expect(page).toHaveURL(/\/$/);
});
