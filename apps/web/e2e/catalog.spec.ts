import { expect, test } from '@playwright/test';
import { apiPost, apiToken, expectAccessible, setLanguage, shot, signedIn, uid } from './support';

/** Catalog lists under Settings: work types, technicians, expense categories. */

test('work types: add with a price, refuse a duplicate, edit, delete', async ({ page }) => {
  const name = `خزف ${uid()}`;
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/settings/work-types');
  await page.getByRole('button', { name: 'إضافة نوع عمل' }).click();
  let dialog = page.getByRole('dialog', { name: 'إضافة نوع عمل' });
  await dialog.getByRole('textbox', { name: 'نوع العمل' }).fill(name);
  await dialog.getByRole('textbox', { name: 'سعر السن الواحد' }).fill('-5');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByText('لا يُسمح بمبلغ سالب هنا.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'سعر السن الواحد' }).fill('1,250.5');
  await dialog.getByRole('textbox', { name: 'الترتيب' }).fill('3');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تمت إضافة نوع العمل.')).toBeVisible();

  await page.getByRole('searchbox').fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('1,250.50');

  await page.getByRole('button', { name: 'إضافة نوع عمل' }).click();
  dialog = page.getByRole('dialog', { name: 'إضافة نوع عمل' });
  await dialog.getByRole('textbox', { name: 'نوع العمل' }).fill(name);
  await dialog.getByRole('textbox', { name: 'سعر السن الواحد' }).fill('1');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByText(`هذا النوع أُضيف مسبقاً: «${name}».`)).toBeVisible();
  await dialog.getByRole('button', { name: 'إلغاء' }).click();

  await row.getByRole('button', { name: `تعديل: ${name}` }).click();
  dialog = page.getByRole('dialog', { name: 'تعديل نوع العمل' });
  await dialog.getByRole('textbox', { name: 'سعر السن الواحد' }).fill('1300');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ نوع العمل.')).toBeVisible();
  await expect(row).toContainText('1,300.00');

  await row.getByRole('button', { name: `حذف: ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByText('تم حذف نوع العمل.')).toBeVisible();
});

test('a work type used by a case is deactivated, not deleted', async ({ page, request }) => {
  const token = await apiToken(request);
  const name = `تاج ${uid()}`;
  const wt = await apiPost<{ id: number }>(request, token, '/work-types', { name, unitPrice: 1000 });
  const doctor = await apiPost<{ id: number }>(request, token, '/doctors', { name: `د. ${uid()}` });
  await apiPost(request, token, '/cases', {
    doctorId: doctor.id,
    patientName: 'مريض',
    expectedDate: '2099-01-01',
    lines: [{ workTypeId: wt.id, toothNo: 21 }],
  });

  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/settings/work-types?q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name: `حذف: ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByText('نوع العمل مستخدم، لذلك أُوقف بدل حذفه.')).toBeVisible();
  await page.getByRole('combobox', { name: 'الحالة' }).selectOption('inactive');
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('موقوف');
});

test('the work-types list in both languages (axe clean)', async ({ page, request }) => {
  const token = await apiToken(request);
  const suffix = uid();
  for (const [name, unitPrice, sortOrder] of [
    [`زيركون ${suffix}`, 25000, 1],
    [`إي-ماكس ${suffix}`, 30000, 2],
    [`خزف على معدن ${suffix}`, 18000, 3],
    [`تاج مؤقت ${suffix}`, 4500, 4],
  ] as const) {
    await apiPost(request, token, '/work-types', { name, unitPrice, sortOrder });
  }
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/settings/work-types?q=${suffix}`);
  await expect(page.getByRole('row')).toHaveCount(5);
  await expectAccessible(page);
  await shot(page, 'work-types-ar');
  await setLanguage(page, 'en');
  await expect(page.getByRole('columnheader', { name: 'Price per tooth (₪)' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'work-types-en');
  await setLanguage(page, 'ar');
});

test('technicians: add, rename, delete', async ({ page }) => {
  const name = `فادي ${uid()}`;
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/settings/technicians');
  await page.getByRole('button', { name: 'إضافة فني' }).click();
  let dialog = page.getByRole('dialog', { name: 'إضافة فني' });
  await dialog.getByRole('textbox', { name: 'اسم الفني' }).fill(name);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تمت إضافة الفني.')).toBeVisible();
  await page.getByRole('searchbox').fill(name);
  await page.getByRole('button', { name: `تعديل: ${name}` }).click();
  dialog = page.getByRole('dialog', { name: 'تعديل الفني' });
  await dialog.getByRole('textbox', { name: 'اسم الفني' }).fill(`${name} 2`);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الفني.')).toBeVisible();
  await page.getByRole('searchbox').fill(`${name} 2`);
  await page.getByRole('button', { name: `حذف: ${name} 2` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByText('تم حذف الفني.')).toBeVisible();
  await expectAccessible(page);
});

test('expense categories: the system doctor-refund category can only be renamed', async ({ page }) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/settings/expense-categories');
  const systemRow = page.getByRole('row', { name: /فئة النظام/ });
  await expect(systemRow).toHaveCount(1);
  await expect(systemRow.getByRole('button', { name: /^حذف:/ })).toHaveCount(0);
  await systemRow.getByRole('button', { name: /^تعديل:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'تعديل الفئة' });
  await expect(dialog.getByRole('checkbox', { name: 'فعّال' })).toBeDisabled();
  await expect(
    dialog.getByText('هذه فئة النظام: يمكن تغيير اسمها فقط، ولا يمكن إيقافها أو حذفها.'),
  ).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'إلغاء' }).click();

  const name = `قرطاسية ${uid()}`;
  await page.getByRole('button', { name: 'إضافة فئة' }).click();
  await page
    .getByRole('dialog', { name: 'إضافة فئة' })
    .getByRole('textbox', { name: 'اسم الفئة' })
    .fill(name);
  await page.getByRole('dialog', { name: 'إضافة فئة' }).getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تمت إضافة الفئة.')).toBeVisible();
});
