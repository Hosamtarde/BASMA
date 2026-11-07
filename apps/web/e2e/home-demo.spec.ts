import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { apiToken, expectAccessible, setLanguage, shot, signedIn } from './support';

/**
 * Home on the "demo" installation: 15 doctors, 8 work types, 3 technicians and 40 cases over six
 * weeks, created by the demo seed through the real API (apps/api/scripts/demo). Direction A
 * details are checked on realistic numbers in both languages, with and without a logo.
 */

const LOGO = fileURLToPath(new URL('../../../assets/logo-clean.png', import.meta.url));
const LAB = { ar: 'مختبر الريحان (بيانات تجريبية)', en: 'Al-Rayhan Lab (demo data)' };
const SLOGAN = 'Precision · Care · On time';

type Counts = { byStatus: Record<string, number>; total: number; overdue: number };

const banner = (page: Page) => page.getByRole('region', { name: /الريحان|Al-Rayhan/ });
const keyNumbers = (page: Page) => page.getByRole('region', { name: /^(الأرقام الرئيسية|Key numbers)$/ });

async function counts(page: Page): Promise<Counts> {
  const token = await apiToken(page.request);
  const res = await page.request.get('/api/v1/cases/summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as Counts;
}

async function bannerHeight(page: Page): Promise<number> {
  return (await banner(page).boundingBox())?.height ?? 0;
}

async function expectLetterSpacedLatin(subtitle: Locator) {
  await expect(subtitle).toHaveAttribute('lang', 'en');
  const style = await subtitle.evaluate((el) => {
    const s = getComputedStyle(el);
    return { spacing: parseFloat(s.letterSpacing), transform: s.textTransform };
  });
  expect(style.spacing).toBeGreaterThan(2);
  expect(style.transform).toBe('uppercase');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signedIn(page);
});

test('demo data without a logo: banner, key numbers, donut and «قريباً» cards in both languages', async ({
  page,
}) => {
  const c = await counts(page);
  expect(c.total).toBe(40);
  expect(c.overdue).toBeGreaterThan(0);
  await setLanguage(page, 'ar');

  await expect(page.getByRole('heading', { level: 1, name: LAB.ar })).toBeVisible();
  const subtitle = banner(page).locator('[data-banner-subtitle]');
  await expect(subtitle).toHaveText(SLOGAN);
  await expectLetterSpacedLatin(subtitle);
  await expect(banner(page).locator('[data-banner-mark]')).toBeVisible();
  await expect(banner(page).getByRole('img')).toHaveCount(0);
  await expect(banner(page)).not.toContainText('DentalLab');
  const heightWithoutLogo = await bannerHeight(page);
  expect(heightWithoutLogo).toBeGreaterThanOrEqual(180);

  const numbers = keyNumbers(page);
  await expect(numbers.getByRole('link', { name: 'الأطباء النشطون 15', exact: true })).toBeVisible();
  await expect(numbers.getByRole('link', { name: 'الحالات 40', exact: true })).toBeVisible();
  await expect(
    numbers.getByRole('link', { name: `جاهزة للتسليم ${c.byStatus.ready}`, exact: true }),
  ).toBeVisible();
  await expect(numbers.getByRole('link', { name: `حالات متأخرة ${c.overdue}`, exact: true })).toBeVisible();
  await expect(numbers).not.toContainText('₪');

  // Thin ring, one arc per status (all seven exist in the demo), nothing written in the centre.
  await expect(
    page.getByRole('img', { name: 'توزيع الحالات حسب المرحلة، المجموع 40', exact: true }),
  ).toBeVisible();
  const arcs = page.locator('circle[data-status]');
  await expect(arcs).toHaveCount(7);
  await expect(arcs.first()).toHaveAttribute('stroke-width', '14');
  await expect(page.locator('svg[role="img"] text')).toHaveCount(0);

  // The three bottom panels line up (same top and height on a wide screen).
  const boxes = await Promise.all(
    [/^الأرقام الرئيسية$/, /^بيان عام على جميع الحالات$/, /^آخر الحالات$/].map(
      async (name) => (await page.getByRole('region', { name }).boundingBox())!,
    ),
  );
  for (const b of boxes) {
    expect(Math.abs(b.y - boxes[0]!.y)).toBeLessThan(1);
    expect(Math.abs(b.height - boxes[0]!.height)).toBeLessThan(1);
  }

  // «قريباً» cards: brand knob and figure band like the live ones, never focusable.
  const cards = page.getByRole('region', { name: 'ماذا تريد أن تسجّل؟' });
  const soon = cards.getByRole('link', { name: /^دفعة واردة/ });
  await expect(soon).toHaveAttribute('aria-disabled', 'true');
  await expect(soon).toContainText('قريباً');
  await expect(soon).toContainText('في تحديث قادم');
  await expect(soon.locator('.knob-soon')).toBeVisible();
  await cards.getByRole('link', { name: /^إضافة حالة جديدة/ }).focus();
  await page.keyboard.press('Tab');
  await expect(cards.getByRole('link', { name: /^الأطباء/ })).toBeFocused();

  // No focus ring in the screenshot.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expectAccessible(page);
  await shot(page, 'home-demo-ar', { fullPage: false });
  await shot(page, 'home-demo-ar-full');

  await setLanguage(page, 'en');
  await expect(page.getByRole('heading', { level: 1, name: LAB.en })).toBeVisible();
  await expectLetterSpacedLatin(banner(page).locator('[data-banner-subtitle]'));
  await expect(keyNumbers(page).getByRole('link', { name: 'Active doctors 15', exact: true })).toBeVisible();
  await expect(keyNumbers(page).getByRole('link', { name: 'Cases 40', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'What do you want to record?' }).getByRole('link', { name: /^Debts/ }),
  ).toContainText('Soon');
  await expectAccessible(page);
  await shot(page, 'home-demo-en', { fullPage: false });
  await shot(page, 'home-demo-en-full');
  await setLanguage(page, 'ar');

  // Key numbers open the matching list.
  await keyNumbers(page)
    .getByRole('link', { name: `حالات متأخرة ${c.overdue}`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/cases\?overdue=1$/);
  await expect(page.getByRole('table', { name: 'الحالات' }).getByRole('row')).toHaveCount(c.overdue + 1);
});

test('demo data with the logo: shown at most at its native size, banner keeps its height', async ({
  page,
}) => {
  await setLanguage(page, 'ar');
  const heightWithoutLogo = await bannerHeight(page);
  await page.goto('/settings');
  await page.locator('#logo-file').setInputFiles(LOGO);
  await expect(page.getByText('تم رفع الشعار.')).toBeVisible();
  await page.getByRole('link', { name: 'الرئيسية' }).click();

  const logo = banner(page).getByRole('img', { name: 'شعار المختبر' });
  await expect(logo).toBeVisible();
  await expect(banner(page).locator('[data-banner-mark]')).toHaveCount(0);
  const size = await logo.evaluate((img: HTMLImageElement) => ({
    width: img.getBoundingClientRect().width,
    natural: img.naturalWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(Math.min(200, size.natural));
  expect(Math.abs((await bannerHeight(page)) - heightWithoutLogo)).toBeLessThanOrEqual(4);

  await page.mouse.move(720, 600);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
  await expectAccessible(page);
  await shot(page, 'home-demo-logo-ar', { fullPage: false });
  await setLanguage(page, 'en');
  await expect(banner(page).getByRole('img', { name: 'Lab logo' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'home-demo-logo-en', { fullPage: false });
  await setLanguage(page, 'ar');

  // Restore: no logo.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'حذف الشعار' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف الشعار' }).click();
  await expect(page.getByText('تم حذف الشعار.')).toBeVisible();
});
