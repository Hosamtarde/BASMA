import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiPost, apiToken, expectAccessible, setLanguage, shot, signedIn, switchLanguage, uid } from './support';

/**
 * B5b items 16 and 17: Home «آخر العمليات» and the «الأكثر استخدامًا» row of the shade guide. Each
 * test seeds its own uniquely named data through the real API and compares what the screen shows
 * with the OTHER endpoint's numbers (never the same endpoint twice).
 */
const DESKTOP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };
const TODAY = new Date().toISOString().slice(0, 10);

interface Seed {
  token: string;
  suffix: string;
  doctorName: string;
  caseNo: number;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `تاج ${suffix}`,
    unitPrice: 40000,
  });
  const doctorName = `د. سامي ${suffix}`;
  const doctor = await apiPost<{ id: number }>(request, token, '/doctors', { name: doctorName });
  const created = await apiPost<{ caseNo: number }>(request, token, '/cases', {
    doctorId: doctor.id,
    patientName: `مريض ${suffix}`,
    receivedDate: TODAY,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: workType.id, unitPrice: 40000, shade: 'A3.5' }],
  });
  return { token, suffix, doctorName, caseNo: created.caseNo };
}

async function expectNoSidewaysScroll(page: Page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(w[0], 'the page must not scroll sideways').toBeLessThanOrEqual(w[1]!);
}

const TEXTS = {
  ar: {
    panel: 'آخر العمليات',
    created: 'إنشاء حالة',
    doctor: 'إضافة طبيب',
    by: 'بواسطة owner',
    frequent: 'الأكثر استخدامًا',
    shade: /^اللون/,
    dialog: 'اختيار اللون',
  },
  en: {
    panel: 'Latest operations',
    created: 'Case created',
    doctor: 'Doctor added',
    by: 'by owner',
    frequent: 'Most used',
    shade: /^Shade/,
    dialog: 'Choose a shade',
  },
} as const;

/** The language belongs to the installation: leave it as other files expect it (Arabic). */
async function restoreArabic(page: Page, lang: 'ar' | 'en') {
  if (lang === 'en') {
    await page.goto('/');
    await switchLanguage(page, /^العربية/);
  }
}

for (const lang of ['ar', 'en'] as const) {
  const T = TEXTS[lang];

  test(`Home «آخر العمليات»: the newest operations, by whom and when, at 1366 and 390 px, axe clean (${lang})`, async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    await page.setViewportSize(DESKTOP);
    await signedIn(page);
    await setLanguage(page, lang);
    try {
      await page.goto('/');
      const panel = page.getByRole('heading', { name: T.panel }).locator('xpath=ancestor::section[1]');
      await expect(panel).toBeVisible();
      // The operations seeded through the API are on the list (newest first: the case before the doctor;
      // other entries, such as a language change by another test, may sit above them).
      const rows = panel.getByRole('listitem');
      const caseLabel = new RegExp('^' + T.created + ' ' + s.caseNo + '$');
      const caseRow = rows.filter({ has: page.getByText(caseLabel) });
      await expect(caseRow).toHaveCount(1);
      await expect(caseRow).toContainText(T.by);
      await expect(caseRow).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
      await expect(rows.filter({ hasText: s.doctorName })).toContainText(T.doctor);
      const texts = await rows.allTextContents();
      expect(texts.findIndex((x) => x.startsWith(T.created + ' ' + s.caseNo))).toBeLessThan(
        texts.findIndex((x) => x.includes(s.doctorName)),
      );
      expect(texts.length).toBeLessThanOrEqual(20);
      // Nothing from a payload reaches the screen: the patient's name is not in the log.
      await expect(panel).not.toContainText('مريض ' + s.suffix);
      await expectAccessible(page);
      await shot(page, 'home-activity-1366-' + lang, { fullPage: true });

      await page.setViewportSize(PHONE);
      await page.goto('/');
      await expect(panel).toBeVisible();
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      await shot(page, 'home-activity-390-' + lang, { fullPage: true });
    } finally {
      await restoreArabic(page, lang);
    }
  });

  test(`shade guide: the «${T.frequent}» row follows the usage counts and picks a shade, at 1366 and 390 px, axe clean (${lang})`, async ({
    page,
    request,
  }) => {
    const s = await seed(request);
    const usage = (await (
      await request.get('/api/v1/cases/shade-usage?limit=8', { headers: { Authorization: 'Bearer ' + s.token } })
    ).json()) as { items: { shade: string; count: number }[] };
    expect(usage.items.length).toBeGreaterThan(0);
    expect(usage.items.length).toBeLessThanOrEqual(8);

    await page.setViewportSize(DESKTOP);
    await signedIn(page);
    await setLanguage(page, lang);
    try {
      await page.goto('/cases/new');
      await page.getByRole('button', { name: T.shade }).click();
      const dialog = page.getByRole('dialog', { name: T.dialog });
      const row = dialog.getByRole('region', { name: T.frequent });
      await expect(row).toBeVisible();
      const buttons = row.getByRole('button');
      await expect(buttons).toHaveCount(usage.items.length);
      await expect(buttons.first()).toHaveText(usage.items[0]!.shade);
      await expectAccessible(page);
      await shot(page, 'shade-frequent-1366-' + lang, { fullPage: false });

      await page.setViewportSize(PHONE);
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);
      await expectNoSidewaysScroll(page);
      await expectAccessible(page);
      await shot(page, 'shade-frequent-390-' + lang, { fullPage: false });

      // Picking from the row sets the shade of the line, like the guide below it.
      await buttons.first().click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('button', { name: T.shade })).toContainText(usage.items[0]!.shade);
    } finally {
      await restoreArabic(page, lang);
    }
  });
}
