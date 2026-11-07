import { expect, test } from '@playwright/test';
import { expectAccessible, PNG_1X1, SEEDED_LAB_AR, setLanguage, shot, signedIn } from './support';

/** Settings (SPEC §5.18). The currency/numbering locks appearing are covered by first-run.spec.ts. */

test('lab profile: both names are kept, one is required, the sidebar follows', async ({ page }) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.getByRole('link', { name: 'الإعدادات' }).click();
  const form = page.getByRole('form', { name: 'بيانات المختبر' });
  const nameAr = form.getByRole('textbox', { name: 'اسم المختبر بالعربية' });
  const nameEn = form.getByRole('textbox', { name: 'اسم المختبر بالإنجليزية' });
  await nameAr.fill('');
  await nameEn.fill('');
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(form.getByText('اكتب اسم المختبر بالعربية أو بالإنجليزية.')).toBeVisible();

  await nameAr.fill(SEEDED_LAB_AR);
  await nameEn.fill('Test Lab');
  await form.getByRole('textbox', { name: 'العنوان' }).fill('رام الله');
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.').first()).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText(SEEDED_LAB_AR);
  // English UI shows the English lab name.
  await setLanguage(page, 'en');
  await expect(page.getByRole('complementary')).toContainText('Test Lab');
  await setLanguage(page, 'ar');
});

test('logo: wrong type and size are refused before upload; a PNG shows in the sidebar until removed', async ({
  page,
}) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/settings');
  const sidebarLogo = page.getByRole('complementary').getByRole('img', { name: 'شعار المختبر' });
  const fileInput = page.locator('#logo-file');

  // Named .png but not a PNG: refused by its bytes.
  await fileInput.setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not really an image'),
  });
  await expect(page.getByText('الشعار يجب أن يكون صورة PNG أو JPEG.')).toBeVisible();
  // Larger than 1 MB.
  const big = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.alloc(1_048_577)]);
  await fileInput.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: big });
  await expect(page.getByText('حجم الملف أكبر من 1 ميغابايت.')).toBeVisible();
  // A GIF is not accepted either.
  await fileInput.setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByText('الشعار يجب أن يكون صورة PNG أو JPEG.')).toBeVisible();
  await expect(sidebarLogo).toHaveCount(0);

  await fileInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByText('تم رفع الشعار.')).toBeVisible();
  await expect(sidebarLogo).toBeVisible();
  // Shown through a blob: URL (the logo needs the bearer token).
  await expect(sidebarLogo).toHaveAttribute('src', /^blob:/);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'حذف الشعار' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'حذف الشعار' }).click();
  await expect(page.getByText('تم حذف الشعار.')).toBeVisible();
  await expect(sidebarLogo).toHaveCount(0);
});

test('language section: the document language is saved separately from the program language', async ({
  page,
}) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'اللغة' });
  await form.getByRole('combobox', { name: 'لغة المستندات' }).selectOption('en');
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.').first()).toBeVisible();
  await page.reload();
  await expect(form.getByRole('combobox', { name: 'لغة المستندات' })).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await form.getByRole('combobox', { name: 'لغة المستندات' }).selectOption('ar');
  await form.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ الإعدادات.').first()).toBeVisible();
});

test('the settings page in both languages (axe clean)', async ({ page }) => {
  await signedIn(page);
  await setLanguage(page, 'ar');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'الإعدادات', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'settings-ar');
  await setLanguage(page, 'en');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'settings-en');
  await setLanguage(page, 'ar');
});
