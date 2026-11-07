import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/** The owner the "app" project's server seeds at start-up (same password as playwright.config.ts). */
export const OWNER = { username: 'owner', password: 'owner-pass-1234' };
export const SEEDED_LAB_AR = 'مختبر التجارب';

/** Unique suffix so tests never collide with each other's data, whatever order they run in. */
export const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** WCAG 2.1 A/AA scan of the current page (DoD: axe clean). */
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

/** Saves a full-page screenshot for the slice report when E2E_SHOTS_DIR is set (never in CI). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

export const AR = { user: 'اسم المستخدم', pass: 'كلمة المرور', submit: 'دخول' };
export const EN = { user: 'Username', pass: 'Password', submit: 'Sign in' };

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

/** A fresh browser has no cookie: sign in from the (Arabic) login page and wait for the shell. */
export async function signedIn(page: Page, password = OWNER.password): Promise<void> {
  await page.goto('/login');
  await signIn(page, OWNER.username, password, AR);
  await expect(page.getByRole('complementary')).toBeVisible();
}

/** Puts the UI in `lang` (saved for the installation when signed in); no-op if already there. */
export async function setLanguage(page: Page, lang: 'ar' | 'en'): Promise<void> {
  if ((await page.locator('html').getAttribute('lang')) !== lang) {
    await page.getByRole('button', { name: new RegExp(`^${lang === 'ar' ? 'العربية' : 'English'}`) }).click();
  }
  await expectDirection(page, lang);
}

/** Bearer token for seeding data through the real API (same rules as the UI). */
export async function apiToken(request: APIRequestContext, password = OWNER.password): Promise<string> {
  const res = await request.post('/api/v1/auth/login', { data: { username: OWNER.username, password } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export async function apiPost<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
): Promise<T> {
  const res = await request.post(`/api/v1${path}`, { data, headers: { Authorization: `Bearer ${token}` } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as T;
}

/** A tiny valid PNG (1×1). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
