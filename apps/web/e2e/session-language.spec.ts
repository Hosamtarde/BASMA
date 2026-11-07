import { expect, test } from '@playwright/test';
import {
  AR,
  EN,
  expectAccessible,
  expectDirection,
  OWNER,
  SEEDED_LAB_AR,
  setLanguage,
  signedIn,
  signIn,
} from './support';

/** Session restore, language saved per installation, sign-out/in. Each test stands alone. */

test('a reload restores the session from the httpOnly cookie; no token is stored', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await expect(page.getByRole('complementary')).toContainText(SEEDED_LAB_AR);
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('complementary')).toContainText(SEEDED_LAB_AR);

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
  await signedIn(page);
  await setLanguage(page, 'ar');
  await setLanguage(page, 'en');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByText('Welcome to')).toBeVisible();
  await page.reload();
  await expectDirection(page, 'en');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expectAccessible(page);
});

test('sign out; a wrong password gets a localized error; a language picked on the login page wins', async ({
  page,
}) => {
  await signedIn(page);
  await setLanguage(page, 'en');
  await page.getByRole('button', { name: `User menu: ${OWNER.username}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expectDirection(page, 'en');
  await expectAccessible(page);

  await signIn(page, OWNER.username, 'not-the-password', EN);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: /^العربية/ }).click();
  await expectDirection(page, 'ar');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await expectAccessible(page);
  await signIn(page, OWNER.username, OWNER.password, AR);
  await expect(page.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('aria-current', 'page');
  await expectDirection(page, 'ar');
  await page.reload();
  await expectDirection(page, 'ar');
});

test('an unknown address shows the not-found page inside the shell', async ({ page }) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible();
  await page.getByRole('link', { name: 'العودة إلى الرئيسية' }).click();
  await expect(page).toHaveURL(/\/$/);
});
