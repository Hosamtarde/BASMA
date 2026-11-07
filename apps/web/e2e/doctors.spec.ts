import { expect, test } from '@playwright/test';
import { apiPost, apiToken, expectAccessible, setLanguage, shot, signedIn, uid } from './support';

/** Doctors (SPEC §5.2) and special prices (§5.12). Every test creates its own uniquely named data. */

test('add, search, edit and delete a doctor; duplicate names are refused inline', async ({ page }) => {
  const name = `د. سامي ${uid()}`;
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'الأطباء' }).click();
  await expect(page.getByRole('heading', { name: 'الأطباء', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'إضافة طبيب' }).click();
  let dialog = page.getByRole('dialog', { name: 'إضافة طبيب' });
  await dialog.getByRole('textbox', { name: 'اسم الطبيب' }).fill(name);
  await dialog.getByRole('textbox', { name: 'العيادة' }).fill('عيادة الأمل');
  await dialog.getByRole('textbox', { name: 'الهاتف' }).fill('059 123 4567');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تمت إضافة الطبيب.')).toBeVisible();

  // Same name again → inline error on the name field, in the server's words.
  await page.getByRole('button', { name: 'إضافة طبيب' }).click();
  dialog = page.getByRole('dialog', { name: 'إضافة طبيب' });
  await dialog.getByRole('textbox', { name: 'اسم الطبيب' }).fill(name);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByRole('textbox', { name: 'اسم الطبيب' })).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText(`يوجد طبيب بالاسم «${name}» مسبقاً.`)).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Search keeps the filter in the address (reload-safe).
  await page.getByRole('searchbox', { name: 'ابحث بالاسم أو العيادة أو الهاتف' }).fill(name);
  await expect(page).toHaveURL(/q=/);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('عيادة الأمل');

  await row.getByRole('button', { name: `تعديل: ${name}` }).click();
  dialog = page.getByRole('dialog', { name: 'تعديل بيانات الطبيب' });
  await dialog.getByRole('textbox', { name: 'العيادة' }).fill('عيادة النور');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ بيانات الطبيب.')).toBeVisible();
  await expect(row).toContainText('عيادة النور');

  // Never used → really deleted.
  await row.getByRole('button', { name: `حذف: ${name}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByText('تم حذف الطبيب.')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
});

test('a doctor with an opening balance is deactivated, not deleted; signed balances are shown', async ({
  page,
}) => {
  const name = `د. رصيد ${uid()}`;
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/doctors');
  await page.getByRole('button', { name: 'إضافة طبيب' }).click();
  const dialog = page.getByRole('dialog', { name: 'إضافة طبيب' });
  await dialog.getByRole('textbox', { name: 'اسم الطبيب' }).fill(name);
  // More decimals than the currency allows is refused, never rounded.
  await dialog.getByRole('textbox', { name: 'الرصيد الافتتاحي' }).fill('-50.505');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByText('يُسمح بخانتين عشريتين فقط.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'الرصيد الافتتاحي' }).fill('-50.5');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تمت إضافة الطبيب.')).toBeVisible();

  await page.getByRole('searchbox').fill(name);
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('-50.50 ₪')).toBeVisible();
  await expect(page.getByText('للطبيب على المختبر')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'حذف' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByText('الطبيب له سجلات، لذلك أُوقف بدل حذفه.')).toBeVisible();
  await expect(page.getByText('موقوف').first()).toBeVisible();
  await page.getByRole('button', { name: 'إعادة التفعيل' }).click();
  await expect(page.getByText('أُعيد تفعيل الطبيب.')).toBeVisible();
});

test('special prices: set, shown as special, back to the general price', async ({ page, request }) => {
  const token = await apiToken(request);
  const suffix = uid();
  const workType = await apiPost<{ id: number; name: string }>(request, token, '/work-types', {
    name: `إي-ماكس ${suffix}`,
    unitPrice: 30000,
  });
  const doctor = await apiPost<{ id: number }>(request, token, '/doctors', {
    name: `د. خاص ${suffix}`,
    clinic: 'عيادة',
  });

  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/doctors/${doctor.id}`);
  await page.getByRole('link', { name: 'الأسعار الخاصة' }).click();
  await expect(page).toHaveURL(new RegExp(`/doctors/${doctor.id}/prices$`));
  const row = page.getByRole('row', { name: new RegExp(workType.name) });
  await expect(row).toContainText('300.00 ₪');
  await expect(row).toContainText('السعر العام');

  const box = row.getByRole('textbox', { name: `السعر الخاص لـ ${workType.name}` });
  await box.fill('abc');
  await row.getByRole('button', { name: 'حفظ' }).click();
  await expect(row.getByText('اكتب مبلغًا صحيحًا مثل 120 أو 120.50.')).toBeVisible();
  await box.fill('275');
  await row.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText(`تم حفظ السعر الخاص لـ ${workType.name}.`)).toBeVisible();
  await expect(row).toContainText('سعر خاص');
  await expect(box).toHaveValue('275.00');
  await expectAccessible(page);
  await shot(page, 'doctor-prices-ar');

  await setLanguage(page, 'en');
  await expect(page.getByRole('link', { name: 'Special prices' })).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);
  await shot(page, 'doctor-prices-en');
  await setLanguage(page, 'ar');

  await row.getByRole('button', { name: `إزالة السعر الخاص لـ ${workType.name}` }).click();
  await expect(page.getByText(`عاد ${workType.name} إلى السعر العام.`)).toBeVisible();
  await expect(row).toContainText('السعر العام');
  await expect(box).toHaveValue('');
});

test('the doctors list in both languages (keyboard reachable, axe clean)', async ({ page, request }) => {
  const token = await apiToken(request);
  const suffix = uid();
  for (const [n, clinic, phone] of [
    [`د. أحمد سالم ${suffix}`, 'عيادة الأمل', '059 111 2222'],
    [`د. ليلى حداد ${suffix}`, 'مركز الابتسامة', '02 298 7766'],
    [`Dr. Omar Khalil ${suffix}`, 'Smile Center', '056 333 4444'],
  ]) {
    await apiPost(request, token, '/doctors', { name: n, clinic, phone });
  }
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto(`/doctors?q=${suffix}`);
  await expect(page.getByRole('row')).toHaveCount(4);
  // Keyboard: the first doctor link is reachable with Tab.
  const firstLink = page.getByRole('link', { name: `د. أحمد سالم ${suffix}` });
  await firstLink.focus();
  await expect(firstLink).toBeFocused();
  await expectAccessible(page);
  await shot(page, 'doctors-ar');
  await setLanguage(page, 'en');
  await expect(page.getByRole('columnheader', { name: 'Doctor name' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'doctors-en');
  await setLanguage(page, 'ar');
});
