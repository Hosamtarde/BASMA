import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { apiPost, apiToken, expectAccessible, setLanguage, shot, signedIn, uid } from './support';

/**
 * F2 (SPEC §5.3, §5.6, §9): add a case with the tooth chart, list/filter/search, status changes,
 * cancel, a stale version in two tabs, and the chart staying fully visible on short screens.
 * Every test seeds its own uniquely named doctor and work type through the real API.
 */

/** Screens with a sticky chart and save bar are captured as the user sees them. */
const VIEWPORT = { fullPage: false };
const REPORT_SIZE = { width: 1440, height: 900 };

interface Seed {
  token: string;
  suffix: string;
  doctor: { id: number; name: string };
  workType: { id: number; name: string };
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number; name: string }>(request, token, '/work-types', {
    name: `زيركون ${suffix}`,
    unitPrice: 25000,
  });
  const doctor = await apiPost<{ id: number; name: string }>(request, token, '/doctors', {
    name: `د. أحمد ${suffix}`,
  });
  return { token, suffix, doctor, workType };
}

async function seedCase(
  request: APIRequestContext,
  s: Seed,
  over: { patientName: string; receivedDate?: string; expectedDate?: string; status?: string },
) {
  return apiPost<{ id: number; caseNo: number }>(request, s.token, '/cases', {
    doctorId: s.doctor.id,
    expectedDate: '2099-12-31',
    lines: [{ toothNo: 11, workTypeId: s.workType.id }],
    ...over,
  });
}

async function pick(page: Page, combobox: string, option: string, search = 'ابحث…') {
  await page.getByRole('combobox', { name: combobox, exact: true }).click();
  await page.getByRole('combobox', { name: search }).fill(option);
  await page.getByRole('option', { name: option }).click();
}

/** Drawn box of the chart (hotspots and badges) in viewport pixels. */
async function chartBox(panel: Locator) {
  return panel.locator('svg[data-view]').evaluate((svg) => {
    const boxes = [...svg.querySelectorAll('[data-layer="hotspots"] path, [data-layer="badges"] circle')].map((el) =>
      el.getBoundingClientRect(),
    );
    const badge = svg.querySelector('[data-layer="badges"] circle')?.getBoundingClientRect();
    return {
      top: Math.min(...boxes.map((b) => b.top)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
      left: Math.min(...boxes.map((b) => b.left)),
      right: Math.max(...boxes.map((b) => b.right)),
      badge: badge?.width ?? 0,
      count: svg.querySelectorAll('[data-layer="hotspots"] [role="checkbox"]').length,
    };
  });
}

test('add a case with teeth and a shade, then open it (Arabic, keyboard on the chart, axe clean)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'إضافة حالة جديدة' }).click();
  await expect(page.getByRole('heading', { name: 'إضافة حالة جديدة', level: 1 })).toBeVisible();

  await pick(page, 'الطبيب', s.doctor.name);
  await page.getByRole('textbox', { name: 'اسم المريض' }).fill(`ليلى حداد ${s.suffix}`);

  // A click selects 13; then the keyboard: 13 → 12 → 11 → 21 → 22 → 23 and Space selects 23.
  const chart = page.getByRole('group', { name: 'مخطط الأسنان' });
  await chart.getByRole('checkbox', { name: 'سن 13، ناب علوي يمين' }).click();
  await chart.getByRole('checkbox', { name: /^سن 13،/ }).press('ArrowRight'); // 12
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // 11, 21, 22, 23
  await expect(chart.getByRole('checkbox', { name: /^سن 23،/ })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(chart.getByRole('checkbox', { name: /^سن 23،/ })).toHaveAttribute('aria-checked', 'true');

  await pick(page, 'نوع العمل', s.workType.name);
  await page.getByRole('button', { name: /^اللون/ }).click();
  const shadeDialog = page.getByRole('dialog', { name: 'اختيار اللون' });
  await expect(shadeDialog.getByText('ألوان الشاشة للإرشاد فقط')).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'shade-classic-ar', VIEWPORT);
  await shadeDialog.getByRole('tab', { name: '3D-Master' }).click();
  await shot(page, 'shade-3d-ar', VIEWPORT);
  await shadeDialog.getByRole('tab', { name: 'الدليل الكلاسيكي' }).click();
  await shadeDialog.getByRole('button', { name: 'A2', exact: true }).click();
  await expect(shadeDialog).toBeHidden();

  await page.getByRole('button', { name: 'إضافة العمل للأسنان المحددة (2)' }).click();
  const lines = page.getByRole('table', { name: 'سطور العمل' });
  await expect(lines.getByRole('row')).toHaveCount(3);
  await expect(lines).toContainText('250.00 ₪');
  await expect(lines).toContainText('A2');
  await expect(chart.getByRole('checkbox', { name: new RegExp(`^سن 13،.*عليه: ${s.workType.name}`) })).toBeVisible();

  // Expected date: typed digits get their dashes; the calendar is there too.
  await page.getByRole('textbox', { name: 'التسليم المتوقع' }).fill('20991231');
  await expect(page.getByRole('textbox', { name: 'التسليم المتوقع' })).toHaveValue('2099-12-31');
  await page.getByRole('button', { name: 'اختيار تاريخ الاستلام من التقويم' }).click();
  await expect(page.getByRole('dialog', { name: 'تقويم: تاريخ الاستلام' })).toBeVisible();
  await page.keyboard.press('Escape');

  await expectAccessible(page);
  await page.getByRole('button', { name: 'منظر الفم' }).click();
  await shot(page, 'new-case-mouth-ar', VIEWPORT);
  await page.getByRole('button', { name: 'منظر أمامي' }).click();
  await shot(page, 'new-case-rows-ar', VIEWPORT);
  await page.getByRole('button', { name: 'منظر الفم' }).click();

  await page.getByRole('button', { name: 'حفظ الحالة' }).click();
  const saved = page.getByRole('heading', { name: /^تم حفظ الحالة رقم \d+\.$/ });
  await expect(saved).toBeVisible();
  await page.getByRole('link', { name: 'فتح الحالة' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^الحالة رقم \d+$/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'سطور العمل' })).toContainText(s.workType.name);
  await expect(page.getByTestId('case-total')).toHaveText('500.00 ₪');
  await expectAccessible(page);
});

test('the add-case screen in English (direction, chart labels, axe)', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize(REPORT_SIZE);
  await signedIn(page);
  await setLanguage(page, 'en');
  await page.goto('/cases/new');
  await expect(page.getByRole('heading', { name: 'New case', level: 1 })).toBeVisible();
  await pick(page, 'Doctor', s.doctor.name, 'Search…');
  const chart = page.getByRole('group', { name: 'Tooth chart' });
  await chart.getByRole('checkbox', { name: 'Tooth 13, upper right canine' }).click();
  await chart.getByRole('checkbox', { name: 'Tooth 23, upper left canine' }).click();
  // 18 stays on the viewer's left in English too.
  const x = async (n: number) => (await chart.getByRole('checkbox', { name: new RegExp(`^Tooth ${n},`) }).boundingBox())?.x ?? 0;
  expect(await x(18)).toBeLessThan(await x(28));
  await pick(page, 'Work type', s.workType.name, 'Search…');
  await page.getByRole('button', { name: 'Add work for the selected teeth (2)' }).click();
  await expect(page.getByRole('table', { name: 'Work lines' }).getByRole('row')).toHaveCount(3);
  await chart.getByRole('checkbox', { name: /^Tooth 36,/ }).click();
  await chart.getByRole('checkbox', { name: /^Tooth 37,/ }).click();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Mouth view' }).click();
  await shot(page, 'new-case-mouth-en', VIEWPORT);
  await page.getByRole('button', { name: 'Front rows' }).click();
  await shot(page, 'new-case-rows-en', VIEWPORT);
  await page.getByRole('button', { name: /^Shade/ }).click();
  await expectAccessible(page);
  await shot(page, 'shade-classic-en', VIEWPORT);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Mouth view' }).click();
  await setLanguage(page, 'ar');
});

test('filter and search the case list; filters stay in the address', async ({ page, request }) => {
  const s = await seed(request);
  const late = await seedCase(request, s, {
    patientName: `متأخرة ${s.suffix}`,
    receivedDate: '2025-01-10',
    expectedDate: '2025-01-15',
  });
  await seedCase(request, s, { patientName: `جاهزة ${s.suffix}`, receivedDate: '2025-02-01', status: 'ready' });
  await seedCase(request, s, { patientName: `تصميم ${s.suffix}`, receivedDate: '2025-03-01' });

  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'الحالات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'الحالات', level: 1 })).toBeVisible();

  await page.getByRole('searchbox', { name: 'ابحث باسم المريض أو رقم الحالة' }).fill(s.suffix);
  await expect(page).toHaveURL(/q=/);
  const table = page.getByRole('table', { name: 'الحالات' });
  await expect(table.getByRole('row')).toHaveCount(4);

  await pick(page, 'الطبيب', s.doctor.name);
  await expect(page).toHaveURL(new RegExp(`doctor=${s.doctor.id}`));
  await page.getByRole('button', { name: 'جاهزة للتسليم' }).click();
  await expect(page).toHaveURL(/status=ready/);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText(`جاهزة ${s.suffix}`);

  await page.getByRole('button', { name: 'الكل', exact: true }).click();
  await page.getByRole('checkbox', { name: 'المتأخرة فقط' }).check();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row', { name: new RegExp(`متأخرة ${s.suffix}`) })).toContainText('متأخرة');

  await page.getByRole('checkbox', { name: 'المتأخرة فقط' }).uncheck();
  await page.getByRole('textbox', { name: 'من تاريخ' }).fill('20250201');
  await page.getByRole('textbox', { name: 'إلى تاريخ' }).fill('20250228');
  await expect(page).toHaveURL(/from=2025-02-01/);
  await expect(table.getByRole('row')).toHaveCount(2);

  // Reload keeps every filter; the case number search finds one case.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'من تاريخ' })).toHaveValue('2025-02-01');
  await expect(table.getByRole('row')).toHaveCount(2);
  await page.goto(`/cases?q=${late.caseNo}`);
  await expect(table.getByRole('row', { name: new RegExp(`متأخرة ${s.suffix}`) })).toBeVisible();

  await page.goto(`/cases?q=${s.suffix}&doctor=${s.doctor.id}`);
  await expect(table.getByRole('row')).toHaveCount(4);
  await expectAccessible(page);
  await shot(page, 'cases-ar');
  await setLanguage(page, 'en');
  await expect(page.getByRole('columnheader', { name: 'Case no.' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'cases-en');
  await setLanguage(page, 'ar');
});

test('change the status with a note, then cancel with a reason', async ({ page, request }) => {
  const s = await seed(request);
  const c = await seedCase(request, s, { patientName: `مراحل ${s.suffix}`, receivedDate: '2025-05-01' });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/cases/${c.id}`);
  await expect(page.getByRole('heading', { name: `الحالة رقم ${c.caseNo}`, level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'تغيير المرحلة' }).click();
  const dialog = page.getByRole('dialog', { name: 'تغيير مرحلة الحالة' });
  // Only what the API allows from «قيد التصميم» (never «ملغاة» here, never the current one).
  await expect(dialog.getByRole('radio')).toHaveCount(4);
  await dialog.getByRole('radio', { name: 'قيد التنفيذ' }).check();
  await dialog.getByRole('textbox', { name: 'ملاحظة' }).fill('بدأ الخراطة');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم تغيير المرحلة إلى «قيد التنفيذ».')).toBeVisible();
  const history = page.getByRole('list').filter({ hasText: 'بدأ الخراطة' });
  await expect(history).toContainText('من «قيد التصميم» إلى «قيد التنفيذ»');
  await expectAccessible(page);
  await shot(page, 'case-details-ar');
  await setLanguage(page, 'en');
  await expect(page.getByRole('heading', { name: `Case ${c.caseNo}`, level: 1 })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'case-details-en');
  await setLanguage(page, 'ar');

  await page.getByRole('button', { name: 'إلغاء الحالة' }).click();
  const cancel = page.getByRole('dialog', { name: `إلغاء الحالة رقم ${c.caseNo}؟` });
  await cancel.getByRole('textbox', { name: 'سبب الإلغاء' }).fill('طلب الطبيب');
  await cancel.getByRole('button', { name: 'إلغاء الحالة' }).click();
  await expect(page.getByText('هذه الحالة ملغاة، ولا يمكن تعديلها.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'تغيير المرحلة' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'إلغاء الحالة' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تعديل البيانات' })).toHaveCount(0);
  await expect(page.getByRole('list').filter({ hasText: 'طلب الطبيب' })).toContainText('«ملغاة»');
});

test('a stale version in a second tab gets the "changed elsewhere" dialog, then reloads', async ({
  page,
  context,
  request,
}) => {
  const s = await seed(request);
  const c = await seedCase(request, s, { patientName: `تبويبان ${s.suffix}` });
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/cases/${c.id}`);
  const second = await context.newPage();
  await second.goto(`/cases/${c.id}`);
  await expect(second.getByRole('heading', { name: `الحالة رقم ${c.caseNo}`, level: 1 })).toBeVisible();
  await second.getByRole('button', { name: 'تغيير المرحلة' }).click();
  const late = second.getByRole('dialog', { name: 'تغيير مرحلة الحالة' });
  await late.getByRole('radio', { name: 'جاهزة للتسليم' }).check();

  // The first tab saves first.
  await page.getByRole('button', { name: 'تغيير المرحلة' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'قيد التنفيذ' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم تغيير المرحلة إلى «قيد التنفيذ».')).toBeVisible();

  await late.getByRole('button', { name: 'حفظ' }).click();
  const stale = second.getByRole('dialog', { name: 'تغيّرت البيانات في مكان آخر' });
  await expect(stale).toBeVisible();
  await expectAccessible(second);
  await stale.getByRole('button', { name: 'إعادة التحميل' }).click();
  await expect(stale).toBeHidden();
  await second.keyboard.press('Escape');
  await expect(second.getByRole('heading', { level: 1 }).locator('..')).toContainText('قيد التنفيذ');
  await second.close();
});

for (const viewport of [
  { width: 1366, height: 620 },
  { width: 1280, height: 560 },
]) {
  test(`the chart stays fully visible at ${viewport.width}x${viewport.height} (both models, after scrolling)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signedIn(page);
    await setLanguage(page, 'ar');
    await page.goto('/cases/new');
    const panel = page.getByTestId('tooth-chart-panel');
    for (const model of ['منظر الفم', 'منظر أمامي']) {
      await page.getByRole('button', { name: model }).click();
      for (const scroll of [0, 10_000]) {
        await page.evaluate((y) => window.scrollTo(0, y), scroll);
        await page.waitForTimeout(150);
        const box = await chartBox(panel);
        expect(box.count).toBe(32);
        expect(box.top, `${model} top after scroll ${scroll}`).toBeGreaterThanOrEqual(65);
        expect(box.bottom, `${model} bottom after scroll ${scroll}`).toBeLessThanOrEqual(viewport.height);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(viewport.width);
        // Badges: 16 px, or 14 px on very short screens (SPEC §1.1).
        expect(box.badge).toBeGreaterThanOrEqual(viewport.height < 600 ? 13.9 : 15.9);
      }
      // No sideways page scroll.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'منظر الفم' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `new-case-mouth-${viewport.width}x${viewport.height}`, VIEWPORT);

    // Short panel → «تكبير المخطط»: the same selection in a large dialog; Esc keeps it.
    await page.getByRole('button', { name: 'تكبير المخطط' }).click();
    const dialog = page.getByRole('dialog', { name: 'تكبير المخطط' });
    await dialog.getByRole('checkbox', { name: /^سن 36،/ }).click();
    const big = await chartBox(dialog);
    expect(big.badge).toBeGreaterThanOrEqual(15.9);
    await expectAccessible(page);
    await shot(page, `chart-expanded-${viewport.width}x${viewport.height}`, VIEWPORT);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'إلغاء تحديد السن 36' })).toBeVisible();
  });
}
