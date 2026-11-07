import { expect, test } from '@playwright/test';
import { AR, EN, expectAccessible, expectDirection, OWNER, signIn } from './support';

/** SPEC §6.1: one smoke test per language that checks direction switching. Independent tests. */
const CASES = [
  {
    lang: 'ar',
    other: 'en',
    labels: AR,
    title: 'تسجيل الدخول',
    home: 'الرئيسية',
    otherHome: 'Home',
    pick: 'العربية',
    switchTo: 'English',
  },
  {
    lang: 'en',
    other: 'ar',
    labels: EN,
    title: 'Sign in',
    home: 'Home',
    otherHome: 'الرئيسية',
    pick: 'English',
    switchTo: 'العربية',
  },
] as const;

for (const c of CASES) {
  test(`smoke (${c.lang}): login, shell and direction switch`, async ({ page }) => {
    await page.goto('/login');
    // Pick the language on the login page explicitly (it then wins over the installation's saved
    // language after sign-in, whatever other tests saved). A fresh browser starts in Arabic.
    if ((await page.locator('html').getAttribute('lang')) === c.lang) {
      await page.getByRole('button', { name: new RegExp(`^${c.switchTo}`) }).click();
    }
    await page.getByRole('button', { name: new RegExp(`^${c.pick}`) }).click();
    await expectDirection(page, c.lang);
    await expect(page.getByRole('heading', { name: c.title })).toBeVisible();

    await signIn(page, OWNER.username, OWNER.password, c.labels);
    await expect(page.getByRole('link', { name: c.home })).toHaveAttribute('aria-current', 'page');
    await expectDirection(page, c.lang);
    await expectAccessible(page);

    await page.getByRole('button', { name: new RegExp(`^${c.switchTo}`) }).click();
    await expectDirection(page, c.other);
    await expect(page.getByRole('link', { name: c.otherHome })).toBeVisible();
  });
}
