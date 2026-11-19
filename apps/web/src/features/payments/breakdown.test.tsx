import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import { DebtsPage } from './DebtsPage';

const DOCTOR = { id: 7, name: 'د. أحمد سالم' };

const debts = () =>
  json(200, {
    summary: { parties: 1, owedToLab: 32000, owedByLab: 0, net: 32000 },
    page: 1,
    pageSize: 25,
    total: 1,
    items: [{ doctor: DOCTOR, active: true, balance: 32000, direction: 'owed_to_lab', pendingCheques: 0 }],
  });

const figures = (balance: number, over: object = {}) => ({
  doctorId: 7,
  openingBalance: 10000,
  charges: 75000,
  received: 43000,
  paidOut: 0,
  pendingCheques: 0,
  pendingRefundCheques: 0,
  refundable: 0,
  balance,
  direction: balance > 0 ? 'owed_to_lab' : balance < 0 ? 'owed_by_lab' : 'settled',
  ...over,
});

const caseRow = (n: number, remaining: number, total = 30000) => ({
  id: 100 + n,
  caseNo: n,
  patientName: `مريض ${n}`,
  receivedDate: `2026-11-0${n}`,
  status: 'design',
  total,
  paid: total - remaining,
  remaining,
});

/** E1 of the B4 plan: opening 100.00 paid, three open cases, 320.00 in all. */
const breakdown = (over: object = {}) => ({
  doctor: DOCTOR,
  figures: figures(32000),
  openingRemaining: 0,
  credit: 0,
  refundsRemaining: 0,
  openRefunds: [],
  tieOut: { openingRemaining: 0, casesRemaining: 32000, refundsRemaining: 0, credit: 0, balance: 32000 },
  openCases: {
    count: 3,
    remaining: 32000,
    total: 3,
    page: 1,
    pageSize: 10,
    items: [caseRow(1, 15000), caseRow(2, 8000, 20000), caseRow(3, 9000, 15000)],
  },
  latestPayments: [
    { id: 3, voucherNo: 'IN-000003', paidAt: '2026-11-10', method: 'transfer', amount: 6000, counted: true, boundCaseNo: 3 },
    { id: 4, voucherNo: 'IN-000004', paidAt: '2026-11-10', method: 'cheque', amount: 5000, counted: false, boundCaseNo: null },
  ],
  ...over,
});

const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });

describe('Debts breakdown dialog (B4, SPEC §5.11)', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  const base = {
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/debts': debts,
    'GET /api/v1/auth/me': me(['ledger.read', 'cases.read', 'exports.run']),
  };

  it('opens from a name, keeps the doctor in the address, and the equation adds up to the balance', async () => {
    stubApi({ ...base, 'GET /api/v1/doctors/7/debt-breakdown': () => json(200, breakdown()) });
    const view = renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts');
    await userEvent.click(await screen.findByRole('button', { name: 'د. أحمد سالم' }));
    await waitFor(() => expect(view.router.state.location.search).toBe('?doctor=7'));

    const dialog = await screen.findByRole('dialog', { name: /تفاصيل ما على د. أحمد سالم/ });
    const table = within(dialog).getByRole('table', { name: 'الحالات التي عليها مبلغ' });
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3 open cases
    expect(within(table).getByText('مريض 2').closest('tr')).toHaveTextContent('80.00 ₪');
    // 150.00 + 80.00 + 90.00 = 320.00 = the balance shown above.
    expect(within(dialog).getByTestId('breakdown-balance')).toHaveTextContent('320.00 ₪');
    expect(within(dialog).getByTestId('breakdown-tie')).toHaveTextContent('320.00 ₪');
    const eq = within(dialog).getByTestId('breakdown-equation');
    expect(eq).toHaveTextContent('0.00 ₪'); // unpaid opening
    expect(eq).toHaveTextContent('320.00 ₪');
    expect(within(dialog).getByRole('link', { name: 'كشف الحساب' })).toHaveAttribute('href', '/doctors/7/statement');
    expect(within(dialog).getByText('IN-000004').closest('li')).toHaveTextContent('غير محتسبة بعد');
    expect(within(dialog).getByRole('button', { name: 'تصدير CSV' })).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(view.router.state.location.search).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens straight from the address (reload, shared link), in English too', async () => {
    await initI18n('en');
    stubApi({ ...base, 'GET /api/v1/doctors/7/debt-breakdown': () => json(200, breakdown()) });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const dialog = await screen.findByRole('dialog', { name: /What د. أحمد سالم owes/ });
    expect(within(dialog).getByTestId('breakdown-tie')).toHaveTextContent('320.00 ₪');
    expect(within(dialog).getByRole('link', { name: 'Statement' })).toBeVisible();
  });

  it('shows the unpaid opening balance and the credit as their own lines of the equation', async () => {
    stubApi({
      ...base,
      'GET /api/v1/doctors/7/debt-breakdown': () =>
        json(
          200,
          breakdown({
            figures: figures(2000),
            openingRemaining: 6000,
            credit: 5000,
            tieOut: { openingRemaining: 6000, casesRemaining: 1000, credit: 5000, balance: 2000 },
            openCases: { count: 1, remaining: 1000, total: 1, page: 1, pageSize: 10, items: [caseRow(1, 1000)] },
          }),
        ),
    });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('debt-breakdown');
    expect(dialog.querySelector('[data-row="opening"]')).toHaveTextContent('60.00 ₪');
    expect(dialog.querySelector('[data-row="credit"]')).toHaveTextContent('50.00 ₪');
    expect(within(dialog).getByTestId('breakdown-tie')).toHaveTextContent('20.00 ₪');
  });

  it('R3: a refund the doctor money no longer covers is its own line, and the equation gets the refunds term', async () => {
    stubApi({
      ...base,
      'GET /api/v1/doctors/7/debt-breakdown': () =>
        json(
          200,
          breakdown({
            figures: figures(30000, { paidOut: 10000 }),
            refundsRemaining: 10000,
            openRefunds: [{ id: 3, voucherNo: 'OUT-000003', date: '2026-11-05', amount: 10000, covered: 0, remaining: 10000 }],
            tieOut: { openingRemaining: 0, casesRemaining: 20000, refundsRemaining: 10000, credit: 0, balance: 30000 },
            openCases: { count: 1, remaining: 20000, total: 1, page: 1, pageSize: 10, items: [caseRow(1, 20000, 20000)] },
          }),
        ),
    });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('debt-breakdown');
    const refund = dialog.querySelector('[data-refund="OUT-000003"]')!;
    expect(refund).toHaveTextContent('استرداد للطبيب');
    expect(refund).toHaveTextContent('2026-11-05');
    expect(refund).toHaveTextContent('100.00 ₪');
    expect(within(refund as HTMLElement).getByRole('link', { name: 'OUT-000003' })).toHaveAttribute('href', '/outgoing?q=OUT-000003');
    expect(within(dialog).getByTestId('breakdown-paid-out')).toHaveTextContent('100.00 ₪');
    // 0 + 200.00 (cases) + 100.00 (refund) − 0 (credit) = 300.00 = the balance.
    expect(within(dialog).getByTestId('breakdown-refunds-remaining')).toHaveTextContent('100.00 ₪');
    expect(within(dialog).getByTestId('breakdown-tie')).toHaveTextContent('300.00 ₪');
    expect(within(dialog).getByTestId('breakdown-equation')).toHaveTextContent('متبقي الاسترداد');
  });

  it('a settled doctor with no refund open has no refunds term in the equation', async () => {
    stubApi({ ...base, 'GET /api/v1/doctors/7/debt-breakdown': () => json(200, breakdown()) });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('debt-breakdown');
    expect(within(dialog).queryByTestId('breakdown-refunds-remaining')).toBeNull();
  });

  it('says nothing is owed for a settled doctor', async () => {
    stubApi({
      ...base,
      'GET /api/v1/doctors/7/debt-breakdown': () =>
        json(
          200,
          breakdown({
            figures: figures(0),
            tieOut: { openingRemaining: 0, casesRemaining: 0, credit: 0, balance: 0 },
            openCases: { count: 0, remaining: 0, total: 0, page: 1, pageSize: 10, items: [] },
            latestPayments: [],
          }),
        ),
    });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    expect(await screen.findByText('لا يوجد مبلغ مستحق على هذا الطبيب.')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'الحالات التي عليها مبلغ' })).toBeNull();
  });

  it('a credit-only doctor gets the explanation and the credit line, not an empty table', async () => {
    stubApi({
      ...base,
      'GET /api/v1/doctors/7/debt-breakdown': () =>
        json(
          200,
          breakdown({
            figures: figures(-5000),
            credit: 5000,
            tieOut: { openingRemaining: 0, casesRemaining: 0, credit: 5000, balance: -5000 },
            openCases: { count: 0, remaining: 0, total: 0, page: 1, pageSize: 10, items: [] },
          }),
        ),
    });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    expect(await screen.findByText('لدى المختبر رصيد دائن لهذا الطبيب ولا توجد حالات مفتوحة.')).toBeVisible();
    expect(screen.getByRole('dialog').querySelector('[data-row="credit"]')).toHaveTextContent('50.00 ₪');
  });

  it('pages the open cases through the address (bp) while the equation keeps covering all of them', async () => {
    const seen: string[] = [];
    stubApi({
      ...base,
      'GET /api/v1/doctors/7/debt-breakdown': (req) => {
        const page = new URL(req.url).searchParams.get('page') ?? '1';
        seen.push(page);
        const items = page === '1' ? [caseRow(1, 1000)] : [caseRow(2, 2000)];
        return json(
          200,
          breakdown({
            tieOut: { openingRemaining: 0, casesRemaining: 3000, credit: 0, balance: 3000 },
            figures: figures(3000),
            openCases: { count: 11, remaining: 3000, total: 11, page: Number(page), pageSize: 10, items },
          }),
        );
      },
    });
    const view = renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('debt-breakdown');
    await userEvent.click(within(dialog).getByRole('button', { name: /التالي|Next|›|2/ }));
    await waitFor(() => expect(view.router.state.location.search).toContain('bp=2'));
    await waitFor(() => expect(seen).toContain('2'));
    expect(within(dialog).getByTestId('breakdown-tie')).toHaveTextContent('30.00 ₪');
  });

  it('a failed load shows an alert with a retry that loads it', async () => {
    let calls = 0;
    stubApi({
      ...base,
      'GET /api/v1/doctors/7/debt-breakdown': () => {
        calls += 1;
        return calls === 1 ? json(500, { error: { code: 'error.internal', message: 'x', params: {}, correlationId: 'r' } }) : json(200, breakdown());
      },
    });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('تعذّر تحميل التفاصيل.');
    await userEvent.click(within(alert).getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByTestId('breakdown-tie')).toHaveTextContent('320.00 ₪');
  });

  it('hides the CSV button without exports.run or without cases.read', async () => {
    stubApi({
      ...base,
      'GET /api/v1/auth/me': me(['ledger.read', 'cases.read']),
      'GET /api/v1/doctors/7/debt-breakdown': () => json(200, breakdown()),
    });
    renderRoutes([{ path: '/debts', element: <DebtsPage /> }], '/debts?doctor=7');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('debt-breakdown');
    expect(within(dialog).queryByRole('button', { name: 'تصدير CSV' })).toBeNull();
    // The page's own CSV button follows the same rule.
    expect(screen.queryAllByRole('button', { name: 'تصدير CSV' })).toHaveLength(0);
  });
});
