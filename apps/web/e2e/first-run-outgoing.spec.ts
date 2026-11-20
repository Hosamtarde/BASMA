import { expect, test } from '@playwright/test';
import { AR, apiToken, expectAccessible, expectDirection, setLanguage, shot, signIn, switchLanguage } from './support';

/**
 * Project "first-run-outgoing": its own empty database. The first-run file locks the currency with
 * the first INCOMING payment; this file proves the other half of production-readiness #14 — the first OUTGOING
 * payment locks it too (B4b) — and shows the empty expenses page of a new installation.
 */
test.describe.configure({ mode: 'serial' });

const OWNER = { username: 'owner', password: 'first-pass-1234' };

test('setup creates the owner; the expenses page of a new installation is empty but ready to use (ar, axe)', async ({ page, request }) => {
  // This file lives once in an installation's life: a retry cannot repeat the wizard. Say so
  // plainly instead of timing out on a form that no longer exists.
  const status = await request.get('/api/v1/setup/status');
  expect(
    ((await status.json()) as { setupRequired: boolean }).setupRequired,
    'the installation is already set up: this is a retry; fix the first failure, it cannot pass again',
  ).toBe(true);
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
  await switchLanguage(page, /^English/);
  await expectDirection(page, 'en');
  await expect(page.getByText('No expenses recorded yet.')).toBeVisible();
  await expectAccessible(page);
  await shot(page, 'outgoing-empty-en');
  // Back to Arabic, and wait until the installation has saved it: the next test starts in Arabic.
  await switchLanguage(page, /^العربية/);
  await expectDirection(page, 'ar');
});

test('currency: editable until the first outgoing payment, then locked with the explanation', async ({ page, request }) => {
  await page.goto('/login');
  await signIn(page, OWNER.username, OWNER.password, AR);
  await expect(page.getByRole('complementary')).toBeVisible();
  await setLanguage(page, 'ar'); // whatever the installation has saved, this test reads Arabic

  await page.getByRole('link', { name: 'الإعدادات' }).click();
  const code = page.getByRole('textbox', { name: 'رمز العملة', exact: true });
  await expect(code).toBeEnabled();
  await expect(page.getByText(/لذلك لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية/)).toHaveCount(0);

  // The first amount in this installation is an expense paid by the lab.
  await page.getByRole('link', { name: 'دفعة صادرة', exact: true }).click();
  const form = page.getByRole('form', { name: 'مصروف جديد' });
  const category = form.getByRole('combobox', { name: /^الفئة/ });
  // The expected category comes from the API (not from reading the box while it may still be
  // empty), and the box is then waited on until that very option has arrived.
  const token = await apiToken(request, OWNER.password);
  const list = (await (
    await request.get('/api/v1/expense-categories?active=true&pageSize=100', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { items: { name: string; isDoctor: boolean }[] };
  const expenseCategory = list.items.find((c) => !c.isDoctor)?.name;
  expect(expenseCategory, 'a seeded expense category').toBeDefined();
  await expect(category.getByRole('option', { name: expenseCategory!, exact: true })).toBeAttached();
  await category.selectOption({ label: expenseCategory! });
  await form.getByRole('textbox', { name: /^المدفوع له/ }).fill('مؤجّر');
  await form.getByRole('textbox', { name: /^المبلغ/ }).fill('500');
  await form.getByRole('button', { name: 'حفظ المصروف' }).click();
  await expect(page.getByText(/تم حفظ المصروف \u2066OUT-000001\u2069\./)).toBeVisible();

  await page.getByRole('link', { name: 'الإعدادات' }).click();
  await page.getByRole('link', { name: 'عام' }).click();
  await expect(code).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'عدد الخانات العشرية' })).toBeDisabled();
  await expect(page.getByText(/لذلك لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية/)).toBeVisible();
  // The symbol always stays editable.
  await expect(page.getByRole('textbox', { name: 'علامة العملة', exact: true })).toBeEnabled();
  await expectAccessible(page);
});
