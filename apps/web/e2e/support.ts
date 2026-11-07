import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const OWNER = { username: 'owner', password: 'first-pass-1234', newPassword: 'second-pass-5678' };
export const LAB_AR = 'مختبر سمايل آرتك لتقنية الأسنان';

/** WCAG 2.1 A/AA scan of the current page (approved DoD: axe clean). */
export async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = result.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(violations).toEqual([]);
}

export async function expectDirection(page: Page, lang: 'ar' | 'en'): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

/** Saves a screenshot for the F0 report when F0_SHOTS_DIR is set (no effect in CI). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.F0_SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

export async function signIn(
  page: Page,
  username: string,
  password: string,
  labels: { user: string; pass: string; submit: string },
) {
  await page.getByRole('textbox', { name: labels.user, exact: true }).fill(username);
  await page.getByRole('textbox', { name: labels.pass, exact: true }).fill(password);
  await page.getByRole('button', { name: labels.submit, exact: true }).click();
}

/** Each test has a fresh browser context: sign in from the (Arabic, default) login page. */
export async function signedIn(page: Page, password: string): Promise<void> {
  await page.goto('/login');
  await signIn(page, OWNER.username, password, AR);
  await expect(page).toHaveURL(/\/$/);
}

export const AR = { user: 'اسم المستخدم', pass: 'كلمة المرور', submit: 'دخول' };
export const EN = { user: 'Username', pass: 'Password', submit: 'Sign in' };
