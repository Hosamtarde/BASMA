import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { APIRequestContext, Download, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

/**
 * Saves a screenshot for the slice report when E2E_SHOTS_DIR is set (never in CI): the full page,
 * or only the viewport for screens with sticky parts (they would land mid-page in a full capture).
 */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  // Settled, not slept: fonts loaded and two frames painted (animations and the focus ring done).
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.fullPage ?? true });
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

/**
 * Signed in: clicks a language button and waits until the installation has saved the choice
 * (`PATCH /settings/language`), so the next test (or a reload) starts in that language. No sleep.
 */
export async function switchLanguage(page: Page, button: RegExp): Promise<void> {
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/api/v1/settings/language') && r.ok(),
  );
  await page.getByRole('button', { name: button }).click();
  await saved;
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

/** Left and right edges of the text inside an element (not its padding box), in viewport pixels. */
export async function textEdges(
  el: import('@playwright/test').Locator,
): Promise<{ left: number; right: number }> {
  return el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
}

/** The reading-start edge of an element's text: right in Arabic, left in English. */
export async function startEdge(el: import('@playwright/test').Locator, lang: 'ar' | 'en'): Promise<number> {
  const e = await textEdges(el);
  return lang === 'ar' ? e.right : e.left;
}

/** POST with an Idempotency-Key (payments, advance); a fresh key per call unless one is given. */
export async function apiPostKey<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
  key: string = crypto.randomUUID(),
): Promise<T> {
  const res = await request.post(`/api/v1${path}`, {
    data,
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as T;
}

/** Reads a downloaded CSV: raw bytes (BOM check), text, parsed rows, header, data rows and the file name. */
export async function readDownload(d: Download) {
  const path = await d.path();
  const raw = readFileSync(path);
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  return { raw, text, rows, header: rows[0] ?? [], data: rows.slice(1), name: d.suggestedFilename() };
}
