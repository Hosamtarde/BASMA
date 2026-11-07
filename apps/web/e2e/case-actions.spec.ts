import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiPost, apiToken, expectAccessible, setLanguage, shot, signedIn, textEdges, uid } from './support';

/**
 * Opening and acting on a case from the list (owner feedback: «how do I open a case?»): the
 * labelled «عرض / تعديل» button, a click on the row, and the «⋮» menu with the same status and
 * cancel dialogs as the details page — only what the API allows. Each test seeds its own data.
 */

async function seed(request: APIRequestContext) {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number }>(request, token, '/work-types', {
    name: `زيركون ${suffix}`,
    unitPrice: 25000,
  });
  const doctor = await apiPost<{ id: number }>(request, token, '/doctors', { name: `د. إجراءات ${suffix}` });
  const make = (patientName: string, status = 'design') =>
    apiPost<{ id: number; caseNo: number }>(request, token, '/cases', {
      doctorId: doctor.id,
      patientName,
      expectedDate: '2099-12-31',
      status,
      lines: [{ toothNo: 11, workTypeId: workType.id }],
    });
  return { suffix, make };
}

const table = (page: Page) => page.getByRole('table', { name: /^(الحالات|Cases)$/ });
const rowOf = (page: Page, caseNo: number) =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: String(caseNo), exact: true }) });

test('open a case from the «عرض / تعديل» button, the row and the menu; the history gets one entry each', async ({
  page,
  request,
}) => {
  const { suffix, make } = await seed(request);
  const c = await make(`فتح ${suffix}`);
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/cases?q=${suffix}`);
  const heading = page.getByRole('heading', { name: `الحالة رقم ${c.caseNo}`, level: 1 });

  // 1. The labelled button (its name includes the case number).
  const view = page.getByRole('link', { name: `عرض / تعديل الحالة ${c.caseNo}` });
  await expect(view).toBeVisible();
  await expect(view).toContainText('عرض / تعديل');
  await view.click();
  await expect(heading).toBeVisible();
  // One history entry: Back returns to the list, not to a duplicate of the case.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/cases\\?q=${suffix}$`));

  // 2. A click on the row (a plain cell), with a pointer cursor.
  const row = rowOf(page, c.caseNo);
  await expect(row).toHaveCSS('cursor', 'pointer');
  await row.getByText(`فتح ${suffix}`).click();
  await expect(heading).toBeVisible();
  await page.goBack();

  // 3. The keyboard: Tab to the button, Enter.
  await view.focus();
  await page.keyboard.press('Enter');
  await expect(heading).toBeVisible();
  await page.goBack();

  // 4. The «⋮» menu.
  await page.getByRole('button', { name: `إجراءات أخرى للحالة ${c.caseNo}` }).click();
  await page.getByRole('menuitem', { name: 'فتح الحالة' }).click();
  await expect(heading).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/cases\\?q=${suffix}$`));
});

test('change status and cancel from the row menu, with the details-page dialogs (both languages)', async ({
  page,
  request,
}) => {
  const { suffix, make } = await seed(request);
  const c = await make(`قائمة ${suffix}`);
  const delivered = await make(`مسلّمة ${suffix}`, 'ready');
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/cases?q=${suffix}`);
  const row = rowOf(page, c.caseNo);

  await page.getByRole('button', { name: `إجراءات أخرى للحالة ${c.caseNo}` }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'تغيير المرحلة' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'إلغاء الحالة' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'cases-menu-ar', { fullPage: false });
  await menu.getByRole('menuitem', { name: 'تغيير المرحلة' }).click();
  const dialog = page.getByRole('dialog', { name: 'تغيير مرحلة الحالة' });
  await dialog.getByRole('radio', { name: 'جاهزة للتسليم' }).check();
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم تغيير المرحلة إلى «جاهزة للتسليم».')).toBeVisible();
  // Still on the list, which shows the new status.
  await expect(page).toHaveURL(new RegExp(`/cases\\?q=${suffix}$`));
  await expect(row).toContainText('جاهزة للتسليم');

  await page.getByRole('button', { name: `إجراءات أخرى للحالة ${c.caseNo}` }).click();
  await page.getByRole('menuitem', { name: 'إلغاء الحالة' }).click();
  const cancel = page.getByRole('dialog', { name: `إلغاء الحالة رقم ${c.caseNo}؟` });
  await cancel.getByRole('textbox', { name: 'سبب الإلغاء' }).fill('طلب الطبيب');
  await cancel.getByRole('button', { name: 'إلغاء الحالة' }).click();
  await expect(row).toContainText('ملغاة');
  await expect(page).toHaveURL(new RegExp(`/cases\\?q=${suffix}$`));

  // A cancelled case: only «فتح الحالة».
  await page.getByRole('button', { name: `إجراءات أخرى للحالة ${c.caseNo}` }).click();
  await expect(page.getByRole('menuitem', { name: 'لا إجراءات أخرى متاحة' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'تغيير المرحلة' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // English: same actions, labelled in English; a delivered case cannot be cancelled.
  await setLanguage(page, 'en');
  await expect(page.getByRole('link', { name: `View / Edit case ${delivered.caseNo}` })).toBeVisible();
  // Stacked toasts are dimmed (axe would flag them); move the mouse off them so they expire.
  await page.mouse.move(720, 600);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
  await expectAccessible(page);
  await shot(page, 'cases-actions-en', { fullPage: false });
  await page.getByRole('button', { name: `More actions for case ${delivered.caseNo}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Cancel case' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'cases-menu-en', { fullPage: false });
  await page.getByRole('menuitem', { name: 'Change status' }).click();
  const en = page.getByRole('dialog', { name: 'Change the case status' });
  await en.getByRole('radio', { name: 'Delivered' }).check();
  await en.getByRole('button', { name: 'Save' }).click();
  await expect(rowOf(page, delivered.caseNo)).toContainText('Delivered');
  await page.getByRole('button', { name: `More actions for case ${delivered.caseNo}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Change status' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Cancel case' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await setLanguage(page, 'ar');
  await shot(page, 'cases-actions-ar', { fullPage: false });
});

test('case list: dates sit under their headers at the start, amounts under theirs at the end', async ({
  page,
  request,
}) => {
  const { suffix, make } = await seed(request);
  const c = await make(`محاذاة ${suffix}`);
  await signedIn(page);
  for (const lang of ['ar', 'en'] as const) {
    await setLanguage(page, lang);
    await page.goto(`/cases?q=${suffix}`);
    const t = table(page);
    const row = rowOf(page, c.caseNo);
    await expect(row).toBeVisible();
    const header = (name: string) => t.getByRole('columnheader', { name, exact: true });
    const cells = await row.getByRole('cell').all();
    const idx = async (name: string) =>
      (await t.getByRole('columnheader').allTextContents()).findIndex((h) => h === name);

    // Received date: start edges match (right in Arabic, left in English).
    const received = lang === 'ar' ? 'تاريخ الاستلام' : 'Received';
    const rCell = cells[await idx(received)]!;
    const [h, v] = [await textEdges(header(received)), await textEdges(rCell.locator('span.num'))];
    expect(Math.abs(lang === 'ar' ? h.right - v.right : h.left - v.left)).toBeLessThanOrEqual(2);

    // Total: end edges match (left in Arabic, right in English); sign after the digits.
    const total = lang === 'ar' ? 'الإجمالي' : 'Total';
    const tCell = cells[await idx(total)]!;
    const [th, tv] = [await textEdges(header(total)), await textEdges(tCell.locator('span.num'))];
    expect(Math.abs(lang === 'ar' ? th.left - tv.left : th.right - tv.right)).toBeLessThanOrEqual(2);
    await expect(tCell).toHaveText(/^250\.00 \S+$/);
  }
  await setLanguage(page, 'ar');
});
