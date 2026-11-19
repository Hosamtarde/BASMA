import { expect, test } from '@playwright/test';
import { AR, expectAccessible, expectDirection, shot, signIn } from './support';

/**
 * Project "first-run-outgoing": its own empty database. The first-run file locks the currency with
 * the first PRICE; this file proves the other half of production-readiness #14 — the first OUTGOING
 * payment locks it too (B4b) — and shows the empty expenses page of a new installation.
 */
test.describe.configure({ mode: 'serial' });

const OWNER = { username: 'owner', password: 'first-pass-1234' };

test('setup creates the owner; the expenses page of a new installation is empty but ready to use (ar, axe)', async ({ page }) => {
  await page.goto('/setup');
  await page.getByRole('textbox', { name: 'اسم المستخدم', exact: true }).fill(OWNER.username);
  await page.getByRole('textbox', { name: 'كلمة المرور', exact: true }).fill(OWNER.password);
  await page.getByRole('textbox', { name: 'تأكيد كلمة المرور', exact: true }).fill(OWNER.password);
  await page.getByRole('textbox', { name: 'اسم المختبر بالعربية', exact: true }).fill('مختبر أول');
  await page.getByRole('textbox', { name: 'الهاتف', exact: true }).fill('02 222 3333');
  await page.getByRole('button', { name: 'إنشاء الحساب والبدء' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'دفعة صادرة', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'دفعة صادرة', level: 1 })).toBeVisible();
  await expectDirection(page, 'ar');
  await expect(page.getByText('لا توجد مصاريف مسجلة بعد.')).toBeVisible();
  await expect(page.getByTestId('expenses-summary')).toContainText('لا توجد مصاريف في هذه الفترة.');
  await expect(page.getByRole('form', { name: 'مصروف جديد' })).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'outgoing-empty-ar');

  // English too.
  await page.getByRole('button', { name: /^English/ }).click();
  await expectDirection(page, 'en');
  await expect(page.getByText('No expenses recorded yet.')).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'outgoing-empty-en');
  await page.getByRole('button', { name: /^العربية/ }).click();
  await expectDirection(page, 'ar');
});

test('currency: editable until the first outgoing payment, then locked with the explanation', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, OWNER.username, OWNER.password, AR);
  await expect(page.getByRole('complementary')).toBeVisible();

  await page.getByRole('link', { name: 'الإعدادات' }).click();
  const code = page.getByRole('textbox', { name: 'رمز العملة', exact: true });
  await expect(code).toBeEnabled();
  await expect(page.getByText(/لذلك لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية/)).toHaveCount(0);

  // The first amount in this installation is an expense paid by the lab.
  await page.getByRole('link', { name: 'دفعة صادرة', exact: true }).click();
  const form = page.getByRole('form', { name: 'مصروف جديد' });
  const category = form.getByRole('combobox', { name: /^الفئة/ });
  await expect(category.getByRole('option')).not.toHaveCount(1); // the seeded categories arrived
  const options = await category.getByRole('option').allTextContents();
  const expenseCategory = options.find((o) => o !== '' && !o.includes('اختر') && !o.includes('استرداد'));
  expect(expenseCategory, 'a seeded expense category').toBeDefined();
  await category.selectOption({ label: expenseCategory! });
  await form.getByRole('textbox', { name: /^المدفوع له/ }).fill('مؤجّر');
  await form.getByRole('textbox', { name: /^المبلغ/ }).fill('500');
  await form.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(page.getByText(/تم حفظ المصروف OUT-000001\./)).toBeVisible();

  await page.getByRole('link', { name: 'الإعدادات' }).click();
  await page.getByRole('link', { name: 'عام' }).click();
  await expect(code).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'عدد الخانات العشرية' })).toBeDisabled();
  await expect(page.getByText(/لذلك لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية/)).toBeVisible();
  // The symbol always stays editable.
  await expect(page.getByRole('textbox', { name: 'علامة العملة', exact: true })).toBeEnabled();
  await expectAccessible(page);
});
