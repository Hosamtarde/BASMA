import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { apiPost, apiToken, expectAccessible, setLanguage, shot, signedIn, uid } from './support';

/** The owner's own lab logo from the repo (assets/), as an installation would upload it. */
const LOGO = fileURLToPath(new URL('../../../assets/logo-clean.png', import.meta.url));

/**
 * Home (direction A): live counts from GET /cases/summary in the pipeline and the donut, overdue,
 * links into the filtered case list, the seven action cards (two live, five «قريباً»), the latest
 * cases, and the logo in the banner. The empty state is checked in first-run.spec.ts (the only
 * installation guaranteed to have no cases). Counts are compared before and after seeding, since
 * other files share this installation.
 */

type Status = 'waiting' | 'design' | 'in_progress' | 'ready' | 'delivered' | 'returned' | 'cancelled';
type Counts = { byStatus: Record<Status, number>; total: number; overdue: number };

async function summary(request: APIRequestContext, token: string): Promise<Counts> {
  const res = await request.get('/api/v1/cases/summary', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  return (await res.json()) as Counts;
}

async function seedCases(request: APIRequestContext, token: string) {
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `زيركون ${suffix}`,
    unitPrice: 25000,
  });
  const doctor = await apiPost<{ id: number }>(request, token, '/doctors', { name: `د. رئيسية ${suffix}` });
  const make = (patientName: string, status: string, expectedDate = '2099-12-31') =>
    apiPost<{ id: number; caseNo: number }>(request, token, '/cases', {
      doctorId: doctor.id,
      patientName,
      receivedDate: '2025-06-01',
      expectedDate,
      status,
      lines: [{ toothNo: 11, workTypeId: workType.id }],
    });
  await make(`انتظار ${suffix}`, 'waiting');
  await make(`تصميم ${suffix}`, 'design');
  await make(`متأخرة ${suffix}`, 'design', '2025-06-02');
  const newest = await make(`جاهزة ${suffix}`, 'ready');
  return { suffix, newest };
}

const pipeline = (page: Page) => page.getByRole('region', { name: /^(مسار الحالات|Case pipeline)$/ });

test('pipeline and donut show live counts; overdue and each stage open the filtered list', async ({
  page,
  request,
}) => {
  const token = await apiToken(request);
  const before = await summary(request, token);
  await seedCases(request, token);
  const after = await summary(request, token);
  expect(after.byStatus.waiting).toBe(before.byStatus.waiting + 1);
  expect(after.byStatus.design).toBe(before.byStatus.design + 2);
  expect(after.byStatus.ready).toBe(before.byStatus.ready + 1);
  expect(after.overdue).toBe(before.overdue + 1);

  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const strip = pipeline(page);
  await expect(
    strip.getByRole('link', { name: `قيد التصميم ${after.byStatus.design}`, exact: true }),
  ).toBeVisible();
  await expect(
    strip.getByRole('link', { name: `جاهزة للتسليم ${after.byStatus.ready}`, exact: true }),
  ).toBeVisible();
  await expect(strip.getByRole('link', { name: `متأخرة ${after.overdue}`, exact: true })).toBeVisible();
  await expect(strip.getByRole('link', { name: `كل الحالات (${after.total})`, exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: `توزيع الحالات حسب المرحلة، المجموع ${after.total}`, exact: true }),
  ).toBeVisible();
  const donut = page.getByRole('region', { name: 'بيان عام على جميع الحالات' });
  await expect(
    donut.getByRole('link', { name: `بالانتظار ${after.byStatus.waiting}`, exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'home-ar', { fullPage: false });
  await shot(page, 'home-ar-full');

  await strip.getByRole('link', { name: `قيد التصميم ${after.byStatus.design}`, exact: true }).click();
  await expect(page).toHaveURL(/\/cases\?status=design$/);
  await expect(
    page.getByRole('button', { name: new RegExp(`^قيد التصميم ${after.byStatus.design}$`) }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await pipeline(page)
    .getByRole('link', { name: `متأخرة ${after.overdue}`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/cases\?overdue=1$/);
  await expect(page.getByRole('checkbox', { name: /^المتأخرة فقط/ })).toBeChecked();
  await expect(page.getByRole('table', { name: 'الحالات' }).getByRole('row')).toHaveCount(
    Math.min(after.overdue, 25) + 1,
  );

  await page.goBack();
  await setLanguage(page, 'en');
  await expect(
    pipeline(page).getByRole('link', { name: `In design ${after.byStatus.design}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: `Cases by status, ${after.total} in total`, exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'home-en', { fullPage: false });
  await shot(page, 'home-en-full');
  await setLanguage(page, 'ar');
});

test('action cards: live ones are links, «قريباً» ones are unavailable and skipped by Tab', async ({
  page,
}) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  const cards = page.getByRole('region', { name: 'ماذا تريد أن تسجّل؟' });
  const add = cards.getByRole('link', { name: /^إضافة حالة جديدة/ });
  const doctors = cards.getByRole('link', { name: /^الأطباء/ });
  await expect(add).toHaveAttribute('href', '/cases/new');
  await expect(doctors).toHaveAttribute('href', '/doctors');
  for (const name of ['دفعة واردة', 'دفعة صادرة', 'الديون', 'سجل الشيكات', 'إنشاء فاتورة']) {
    const card = cards.getByRole('link', { name: new RegExp(`^${name}`) });
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await expect(card).not.toHaveAttribute('href');
    await expect(card).toContainText('قريباً');
    await expect(card).toContainText('في تحديث قادم');
    await expect(card.locator('.knob-soon')).toBeVisible();
  }
  // Keyboard: from the first card, Tab goes straight to the doctors card (no trap, no dead stop).
  await add.focus();
  await page.keyboard.press('Tab');
  await expect(doctors).toBeFocused();
  // A disabled card does nothing when clicked.
  // (force: Playwright never clicks an aria-disabled element on its own.)
  await cards.getByRole('link', { name: /^دفعة واردة/ }).click({ force: true });
  await expect(page).toHaveURL(/\/$/);
  await add.click();
  await expect(page).toHaveURL(/\/cases\/new$/);
});

test('latest cases open their details from the number, the «فتح» button or the row', async ({
  page,
  request,
}) => {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `زيركون ${suffix}`,
    unitPrice: 100,
  });
  const doctor = await apiPost<{ id: number }>(request, token, '/doctors', { name: `د. أحدث ${suffix}` });
  // Received today with the highest number: first in the latest list.
  const newest = await apiPost<{ id: number; caseNo: number }>(request, token, '/cases', {
    doctorId: doctor.id,
    patientName: `أحدث ${suffix}`,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: workType.id }],
  });
  await signedIn(page);
  await setLanguage(page, 'ar');
  const latest = page.getByRole('region', { name: 'آخر الحالات' });
  await expect(latest.getByRole('listitem')).toHaveCount(5);
  const first = latest.getByRole('listitem').first();
  const no = String(newest.caseNo);
  await expect(first.getByRole('link').first()).toHaveText(no);
  await first.getByRole('link', { name: `فتح الحالة ${no}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `الحالة رقم ${no}`, level: 1 })).toBeVisible();
  await page.goBack();
  // A click on the row (not on a control) opens it too, once.
  await page
    .getByRole('region', { name: 'آخر الحالات' })
    .getByRole('listitem')
    .first()
    .locator('span.truncate')
    .click();
  await expect(page.getByRole('heading', { name: `الحالة رقم ${no}`, level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  expect(newest.caseNo).toBeGreaterThan(0);
});

test('the banner shows the uploaded logo next to the lab name, and only the name without it', async ({
  page,
}) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  const banner = page.getByRole('region', { name: /مختبر/ }).first();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(banner.getByRole('img')).toHaveCount(0);

  await page.goto('/settings');
  await page.locator('#logo-file').setInputFiles(LOGO);
  await expect(page.getByText('تم رفع الشعار.')).toBeVisible();
  await page.getByRole('link', { name: 'الرئيسية' }).click();
  const logo = page.getByRole('main').getByRole('img', { name: 'شعار المختبر' });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /^blob:/);
  // The sidebar card shows it too.
  await expect(page.getByRole('complementary').getByRole('img', { name: 'شعار المختبر' })).toBeVisible();
  // Let the upload toast expire so it does not cover the sidebar in the screenshot.
  await page.mouse.move(720, 600);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
  await expectAccessible(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await shot(page, 'home-logo-ar', { fullPage: false });
  await setLanguage(page, 'en');
  await expect(page.getByRole('main').getByRole('img', { name: 'Lab logo' })).toBeVisible();
  await shot(page, 'home-logo-en', { fullPage: false });
  await setLanguage(page, 'ar');

  // Restore the installation: no logo.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'حذف الشعار' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف الشعار' }).click();
  await expect(page.getByText('تم حذف الشعار.')).toBeVisible();
});

test('the slogan from Settings shows under the lab name in both languages, and goes away when cleared', async ({
  page,
}) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  const subtitle = page.getByRole('main').locator('[data-banner-subtitle]');
  // No slogan: the other-language name, letter-spaced Latin capitals.
  await expect(subtitle).toHaveText('Test Lab');
  await expect(subtitle).toHaveAttribute('lang', 'en');
  await expect(subtitle).toHaveCSS('text-transform', 'uppercase');

  const slogan = `الدقة في كل سن ${uid()}`;
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'بيانات المختبر' });
  const field = form.getByRole('textbox', { name: 'الشعار النصي (اختياري)' });
  await field.fill('x'.repeat(81));
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(form.getByText('النص أطول من المسموح (الحد 80).')).toBeVisible();
  await field.fill(slogan);
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'الرئيسية' }).click();
  await expect(subtitle).toHaveText(slogan);
  // Arabic is never letter-spaced.
  await expect(subtitle).toHaveAttribute('lang', 'ar');
  await expect(subtitle).toHaveCSS('letter-spacing', 'normal');
  await expectAccessible(page);
  await setLanguage(page, 'en');
  await expect(subtitle).toHaveText(slogan);
  await setLanguage(page, 'ar');

  await page.goto('/settings');
  await page
    .getByRole('form', { name: 'بيانات المختبر' })
    .getByRole('textbox', { name: 'الشعار النصي (اختياري)' })
    .fill('');
  await page.getByRole('form', { name: 'بيانات المختبر' }).getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.').first()).toBeVisible();
  await page.getByRole('link', { name: 'الرئيسية' }).click();
  await expect(subtitle).toHaveText('Test Lab');
});
