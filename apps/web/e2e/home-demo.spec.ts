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

test('demo data without a logo: banner, key numbers, donut and the action cards in both languages', async ({
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
  await expect(banner(page)).not.toContainText('بسمة');
  await expect(banner(page)).not.toContainText('Basma');
  await expect(banner(page).locator('[data-product-logo]')).toHaveCount(0);
  const heightWithoutLogo = await bannerHeight(page);
  expect(heightWithoutLogo).toBeGreaterThanOrEqual(180);

  const numbers = keyNumbers(page);
  await expect(numbers.getByRole('link', { name: 'الأطباء النشطون 15', exact: true })).toBeVisible();
  await expect(numbers.getByRole('link', { name: 'الحالات 40', exact: true })).toBeVisible();
  await expect(
    numbers.getByRole('link', { name: `جاهزة للتسليم ${c.byStatus.ready}`, exact: true }),
  ).toBeVisible();
  await expect(numbers.getByRole('link', { name: `حالات متأخرة ${c.overdue}`, exact: true })).toBeVisible();
  // The money figures are the ledger's own (B3): the demo seed records payments and cheques.
  const token = await apiToken(page.request);
  const ledger = (await (
    await page.request.get('/api/v1/ledger/summary', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as {
    receivedThisMonth: number;
    owedToLab: number;
    pendingChequesCount: number;
    outgoingThisMonth: number;
    chequesDueSoon: number;
    chequesOverdue: number;
    outgoingChequesDueSoon: number;
    outgoingChequesOverdue: number;
  };
  const money = (minor: number) => `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} ₪`;
  expect(ledger.receivedThisMonth).toBeGreaterThan(0);
  expect(ledger.owedToLab).toBeGreaterThan(0);
  await expect(numbers.getByRole('link', { name: `المقبوض هذا الشهر ${money(ledger.receivedThisMonth)}`, exact: true })).toBeVisible();
  await expect(numbers.getByRole('link', { name: `المستحق للمختبر ${money(ledger.owedToLab)}`, exact: true })).toBeVisible();
  await expect(numbers.getByRole('link', { name: `شيكات قيد التحصيل ${ledger.pendingChequesCount}`, exact: true })).toBeVisible();
  // B4b: expenses this month. Checked against a DIFFERENT endpoint (the expenses report of the same
  // month, by effective date) so the Home figure and the report cannot both be wrong the same way.
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const today = new Date().toISOString().slice(0, 10);
  const report = (await (
    await page.request.get(`/api/v1/outgoing-payments/summary?from=${monthStart}&to=${today}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { counted: { amount: number } };
  expect(ledger.outgoingThisMonth).toBeGreaterThan(0);
  expect(ledger.outgoingThisMonth).toBe(report.counted.amount);
  await expect(numbers.getByRole('link', { name: `المصاريف هذا الشهر ${money(ledger.outgoingThisMonth)}`, exact: true })).toBeVisible();
  await expect(numbers).not.toContainText(/الفواتير/);

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

  // B6: the invoice card is live; its figure is the active cases and free invoices of the demo, compared
  // with the OTHER endpoint (GET /invoices/summary), not the same number twice (I8: statements not counted).
  const cards = page.getByRole('region', { name: 'ماذا تريد أن تسجّل؟' });
  const invoiceCard = cards.getByRole('link', { name: /^إنشاء فاتورة/ });
  await expect(invoiceCard).toHaveAttribute('href', '/invoices/new');
  await expect(cards.locator('.knob-soon')).toHaveCount(0);
  const invoices = (await (
    await page.request.get('/api/v1/invoices/summary', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { active: { cases: number; statement: number; free: number }; void: number };
  // The demo issues cases invoices (one voided and re-issued), two statements and two free invoices.
  expect(invoices.active.cases).toBeGreaterThanOrEqual(4);
  expect(invoices.active.statement).toBe(2);
  expect(invoices.active.free).toBe(2);
  expect(invoices.void).toBe(1);
  await expect(invoiceCard).toContainText(`${invoices.active.cases + invoices.active.free} فواتير فعالة`);
  await cards.getByRole('link', { name: /^سجل الشيكات/ }).focus();
  await page.keyboard.press('Tab');
  await expect(invoiceCard).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cards.getByRole('link', { name: /^الأطباء/ })).toBeFocused();
  // The built money cards carry real figures from the demo ledger.
  await expect(cards.getByRole('link', { name: /^دفعة واردة/ })).toContainText('مقبوضة هذا الشهر');
  await expect(cards.getByRole('link', { name: /^الديون/ })).toContainText('مستحقة للمختبر');
  await expect(cards.getByRole('link', { name: /^سجل الشيكات/ })).toContainText('شيكات تستحق قريبًا');
  // B4b: the outgoing card is a live link with this month's expenses; the cheques card counts both
  // directions (the doctors' cheques and the lab's own, X11).
  const outgoingCard = cards.getByRole('link', { name: /^دفعة صادرة/ });
  await expect(outgoingCard).toHaveAttribute('href', '/outgoing');
  await expect(outgoingCard).toContainText(`${money(ledger.outgoingThisMonth)} مصاريف هذا الشهر`);
  const dueBoth =
    ledger.chequesDueSoon + ledger.chequesOverdue + ledger.outgoingChequesDueSoon + ledger.outgoingChequesOverdue;
  await expect(cards.getByRole('link', { name: /^سجل الشيكات/ })).toContainText(`${dueBoth} شيكات تستحق قريبًا`);

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
  const cardsEn = page.getByRole('region', { name: 'What do you want to record?' });
  await expect(cardsEn.getByRole('link', { name: /^Create invoice/ })).toContainText(`${invoices.active.cases + invoices.active.free} active invoices`);
  await expect(cardsEn.getByRole('link', { name: /^Outgoing payment/ })).toContainText('spent this month');
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
