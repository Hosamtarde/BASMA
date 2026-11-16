import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { balanceFixture, settingsFixture } from '@/test/fixtures';
import { envelope, json, renderPage, renderRoutes, stubApi } from '@/test/render';
import type { Payment } from './api';
import { ChequesPage } from './ChequesPage';
import { DebtsPage } from './DebtsPage';
import { PaymentForm } from './PaymentForm';

const DOCTOR = { id: 7, name: 'د. أحمد سالم' };

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 1,
  voucherNo: 'IN-000001',
  doctor: DOCTOR,
  case: null,
  method: 'cash',
  amount: 15050,
  currencyCode: 'ILS',
  paidAt: '2026-11-10',
  notes: null,
  status: 'active',
  voidReason: null,
  voidedAt: null,
  counted: true,
  cheque: null,
  rowVersion: 1,
  createdAt: '2026-11-10T10:00:00Z',
  ...over,
});

const chequePayment = (over: Partial<NonNullable<Payment['cheque']>> = {}, p: Partial<Payment> = {}) =>
  payment({
    id: 2,
    voucherNo: 'IN-000002',
    method: 'cheque',
    amount: 50000,
    counted: false,
    cheque: {
      id: 9,
      chequeNo: '10456',
      bank: 'بنك فلسطين',
      dueDate: '2026-11-12',
      status: 'pending',
      statusDate: null,
      dueState: 'none',
      allowedStatuses: ['cleared', 'returned'],
      rowVersion: 1,
      ...over,
    },
    ...p,
  });

const page = (items: object[], extra: object = {}) => ({
  page: 1,
  pageSize: 25,
  total: items.length,
  items,
  ...extra,
});

const common = {
  'GET /api/v1/settings': () => json(200, settingsFixture()),
  'GET /api/v1/doctors/7/balance': () => json(200, balanceFixture(7, 40000)),
  'GET /api/v1/cases': () => json(200, page([])),
};

describe('PaymentForm', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the doctor’s balance and sends integer minor units with an Idempotency-Key', async () => {
    const keys: (string | null)[] = [];
    const calls = stubApi({
      ...common,
      'POST /api/v1/payments': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        return json(201, { payment: payment(), doctorBalance: 24950 });
      },
    });
    renderPage(<PaymentForm doctor={DOCTOR} />);
    await waitFor(() => expect(screen.getByTestId('payment-balance')).toHaveTextContent('400.00 ₪'));
    expect(screen.getByTestId('payment-balance')).toHaveTextContent('مستحق للمختبر');
    await userEvent.type(screen.getByRole('textbox', { name: /^المبلغ/ }), '150.50');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    await waitFor(() => expect(keys).toHaveLength(1));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/payments')?.body ?? '{}');
    expect(body).toMatchObject({ doctorId: 7, method: 'cash', amount: 15050 });
    expect(body.cheque).toBeUndefined();
    expect(Number.isInteger(body.amount)).toBe(true);
    expect(await screen.findByRole('textbox', { name: /^المبلغ/ })).toHaveValue('');
  });

  it('asks for what is missing in Arabic and sends nothing', async () => {
    const calls = stubApi(common);
    renderPage(<PaymentForm doctor={DOCTOR} />);
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    const amount = await screen.findByRole('textbox', { name: /^المبلغ/ });
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    expect(amount).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    await userEvent.type(amount, '0');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    await waitFor(() => expect(amount).toHaveAccessibleDescription('أدخل مبلغًا أكبر من صفر.'));
    await userEvent.clear(amount);
    await userEvent.type(amount, '1.234');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    expect(calls.some((c) => c.key === 'POST /api/v1/payments')).toBe(false);
  });

  it('shows the cheque fields only for a cheque and requires all three', async () => {
    const calls = stubApi(common);
    renderPage(<PaymentForm doctor={DOCTOR} />);
    expect(screen.queryByRole('textbox', { name: /^رقم الشيك/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'شيك' }));
    expect(await screen.findByRole('textbox', { name: /^رقم الشيك/ })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^المبلغ/ }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    expect(await screen.findByText('أدخل رقم الشيك.')).toBeInTheDocument();
    expect(screen.getByText('أدخل اسم البنك.')).toBeInTheDocument();
    expect(screen.getByText('أدخل تاريخ استحقاق الشيك.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/v1/payments')).toBe(false);
    await userEvent.click(screen.getByRole('radio', { name: 'نقدًا' }));
    expect(screen.queryByRole('textbox', { name: /^رقم الشيك/ })).not.toBeInTheDocument();
  });

  it('retrying the same request reuses its key; a changed request gets a new one', async () => {
    const keys: (string | null)[] = [];
    stubApi({
      ...common,
      'POST /api/v1/payments': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        return json(
          409,
          envelope('error.payment.exceeds_case_total', 'المبلغ أكبر من المتبقي غير المدفوع على الحالة (10.00 ₪).'),
        );
      },
    });
    renderPage(<PaymentForm doctor={DOCTOR} />);
    const amount = screen.getByRole('textbox', { name: /^المبلغ/ });
    await userEvent.type(amount, '50');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    await waitFor(() => expect(keys).toHaveLength(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('أكبر من المتبقي');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await userEvent.clear(amount);
    await userEvent.type(amount, '60');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدفعة' }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe('ChequesPage', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('marks due and overdue cheques, offers only the statuses the API allows, and keeps the filters in the address', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cheques': () =>
        json(
          200,
          page([
            chequePayment({ dueState: 'overdue' }),
            chequePayment(
              { id: 10, chequeNo: '777', status: 'returned', statusDate: '2026-11-09', allowedStatuses: [] },
              { id: 3, voucherNo: 'IN-000003' },
            ),
          ]),
        ),
      'GET /api/v1/cheques/summary': () =>
        json(200, { byStatus: { pending: 1, cleared: 0, returned: 1 }, dueSoon: 0, overdue: 1, pendingAmount: 50000 }),
    });
    const view = renderRoutes([{ path: '/cheques', element: <ChequesPage /> }], '/cheques');
    const overdueRow = (await screen.findByText('10456')).closest('tr')!;
    expect(within(overdueRow).getByText('متأخر')).toBeInTheDocument();
    expect(overdueRow).toHaveAttribute('data-due', 'overdue');
    const returnedRow = screen.getByText('777').closest('tr')!;
    const action = within(returnedRow).getByRole('button', { name: /^تغيير الحالة/ });
    expect(action).toHaveAttribute('aria-disabled', 'true');
    expect(action).toHaveAccessibleDescription('لا توجد تغييرات أخرى لحالة هذا الشيك.');

    await userEvent.click(within(overdueRow).getByRole('button', { name: /^تغيير الحالة/ }));
    const dialog = await screen.findByRole('dialog', { name: 'تغيير حالة الشيك 10456' });
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['تم الصرف', 'مرتجع']);
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: /^مرتجع/ }));
    await waitFor(() => expect(view.router.state.location.search).toBe('?status=returned'));
    await waitFor(() =>
      expect(calls.some((c) => c.key === 'GET /api/v1/cheques')).toBe(true),
    );
  });
});

describe('DebtsPage', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the four figures, opens the breakdown from a name, links the statement and filters by direction in the address', async () => {
    const seen: string[] = [];
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/debts': (req) => {
        seen.push(new URL(req.url).search);
        return json(200, {
          summary: { parties: 2, owedToLab: 80000, owedByLab: 5000, net: 75000 },
          page: 1,
          pageSize: 25,
          total: 2,
          items: [
            { doctor: DOCTOR, active: true, balance: 80000, direction: 'owed_to_lab', pendingCheques: 0 },
            { doctor: { id: 8, name: 'د. رنا' }, active: true, balance: -5000, direction: 'owed_by_lab', pendingCheques: 20000 },
          ],
        });
      },
    });
    const view = renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts');
    expect(await screen.findByRole('link', { name: 'كشف حساب د. أحمد سالم' })).toHaveAttribute('href', '/doctors/7/statement');
    const cards = screen.getByRole('region', { name: 'الديون' });
    // The currency sign arrives with the settings.
    await waitFor(() => expect(cards).toHaveTextContent('800.00 ₪'));
    expect(cards).toHaveTextContent('50.00 ₪');
    expect(cards).toHaveTextContent('750.00 ₪');
    const credit = screen.getByRole('button', { name: 'د. رنا' }).closest('tr')!;
    expect(credit).toHaveTextContent('مستحق عليّ');
    expect(credit).toHaveTextContent('50.00 ₪'); // shown without a sign: the badge says the direction
    await userEvent.click(screen.getByRole('button', { name: 'مستحق عليّ' }));
    await waitFor(() => expect(view.router.state.location.search).toBe('?dir=owed_by_lab'));
    await waitFor(() => expect(seen.some((s) => s.includes('direction=owed_by_lab'))).toBe(true));
    expect(screen.getByRole('button', { name: 'مستحق عليّ' })).toHaveAttribute('aria-pressed', 'true');
  });
});
