import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import { GeneralSettingsPage } from './GeneralSettingsPage';
import { ExpenseCategoriesPage } from './ListPages';

const render = () =>
  renderRoutes(
    [
      {
        path: '/settings',
        element: (
          <Suspense fallback={null}>
            <GeneralSettingsPage />
          </Suspense>
        ),
      },
    ],
    '/settings',
  );

describe('general settings', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('explains the currency lock and never sends locked fields', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () =>
        json(
          200,
          settingsFixture({
            currency: {
              code: 'ILS',
              symbol: '₪',
              decimals: 2,
              rowVersion: 6,
              locked: { code: true, decimals: true },
            },
          }),
        ),
      'PATCH /api/v1/settings/currency': () => json(200, settingsFixture()),
    });
    render();
    const form = await screen.findByRole('form', { name: 'العملة' });
    expect(within(form).getByRole('textbox', { name: 'رمز العملة' })).toBeDisabled();
    expect(within(form).getByRole('combobox', { name: 'عدد الخانات العشرية' })).toBeDisabled();
    expect(
      within(form).getByText(/لذلك لا يمكن تغيير رمز العملة ولا عدد الخانات العشرية/),
    ).toBeInTheDocument();

    const symbol = within(form).getByRole('textbox', { name: 'علامة العملة' });
    await userEvent.clear(symbol);
    await userEvent.type(symbol, 'ش.ج');
    await userEvent.click(within(form).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/v1/settings/currency')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.key === 'PATCH /api/v1/settings/currency')?.body ?? '{}')).toEqual({
      rowVersion: 6,
      symbol: 'ش.ج',
    });
  });

  it('locks a counter once a number was issued and shows the next number', async () => {
    stubApi({
      'GET /api/v1/settings': () =>
        json(
          200,
          settingsFixture({
            numbering: {
              caseNo: { startValue: 500, nextValue: 523, locked: true },
              invoiceNo: { startValue: 1, nextValue: 1, locked: false },
            },
          }),
        ),
    });
    render();
    const form = await screen.findByRole('form', { name: 'الترقيم' });
    expect(within(form).getByRole('textbox', { name: 'رقم أول حالة' })).toBeDisabled();
    expect(
      within(form).getByText('صدر أول رقم، فلا يمكن تغيير البداية. الرقم التالي: 523.'),
    ).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'رقم أول فاتورة' })).toBeEnabled();
  });

  it('refuses a non-image logo before uploading', async () => {
    const calls = stubApi({ 'GET /api/v1/settings': () => json(200, settingsFixture()) });
    render();
    const input = await screen.findByLabelText('شعار المختبر');
    await userEvent.upload(input, new File(['not an image'], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByText('الشعار يجب أن يكون صورة PNG أو JPEG.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'PUT /api/v1/settings/logo')).toBe(false);
  });
});

describe('expense categories', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the system doctor-refund category can be renamed only', async () => {
    stubApi({
      'GET /api/v1/expense-categories': () =>
        json(200, {
          page: 1,
          pageSize: 25,
          total: 2,
          items: [
            { id: 1, name: 'إرجاع للطبيب', isDoctor: true, active: true, rowVersion: 1 },
            { id: 2, name: 'قرطاسية', isDoctor: false, active: true, rowVersion: 1 },
          ],
        }),
    });
    renderRoutes([{ path: '/', element: <ExpenseCategoriesPage /> }]);
    const system = await screen.findByRole('row', { name: /إرجاع للطبيب/ });
    expect(system).toHaveTextContent('فئة النظام');
    expect(within(system).queryByRole('button', { name: /^حذف:/ })).toBeNull();
    expect(
      within(screen.getByRole('row', { name: /قرطاسية/ })).getByRole('button', { name: 'حذف: قرطاسية' }),
    ).toBeInTheDocument();
    await userEvent.click(within(system).getByRole('button', { name: 'تعديل: إرجاع للطبيب' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'فعّال' })).toBeDisabled();
  });
});
