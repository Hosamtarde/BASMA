import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import { DoctorStatementTab } from './DoctorTabs';
import { ReceiptsSummary } from './ReceiptsSummary';

const summary = (over: object = {}) => ({
  counted: { amount: 16500, count: 3, byMethod: { cash: 10000, transfer: 2500, cheque: 4000 } },
  pendingCheques: { count: 1, amount: 900 },
  voided: { count: 1, amount: 700 },
  last: { voucherNo: 'IN-000009', paidAt: '2026-11-07', amount: 900 },
  basis: 'effective',
  ...over,
});

describe('ReceiptsSummary (B4)', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows what counted by method, the memo lines, the last payment and says which date it reads', async () => {
    const seen: string[] = [];
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/payments/summary': (req) => {
        seen.push(new URL(req.url).search);
        return json(200, summary());
      },
    });
    renderRoutes([{ path: '/', element: <ReceiptsSummary params={{ search: '', from: '2026-11-01', to: '2026-11-30', method: 'cash' }} /> }]);
    const box = await screen.findByTestId('receipts-summary');
    await within(box).findByTestId('receipts-counted');
    expect(within(box).getByTestId('receipts-counted')).toHaveTextContent('165.00 ₪');
    expect(box.querySelector('[data-method="cash"]')).toHaveTextContent('100.00 ₪');
    expect(box.querySelector('[data-method="transfer"]')).toHaveTextContent('25.00 ₪');
    expect(box.querySelector('[data-method="cheque"]')).toHaveTextContent('40.00 ₪');
    expect(box).toHaveTextContent('9.00 ₪'); // pending cheques and the last payment
    expect(box).toHaveTextContent('7.00 ₪'); // cancelled
    expect(box).toHaveTextContent('IN-000009');
    expect(box).toHaveTextContent('3 دفعات');
    expect(box).toHaveTextContent('حسب تاريخ التحصيل');
    const q = new URLSearchParams(seen[0]);
    expect(q.get('from')).toBe('2026-11-01');
    expect(q.get('to')).toBe('2026-11-30');
    expect(q.get('method')).toBe('cash');
  });

  it('says there are no receipts for an empty period, in English too', async () => {
    await initI18n('en');
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/payments/summary': () =>
        json(
          200,
          summary({
            counted: { amount: 0, count: 0, byMethod: { cash: 0, transfer: 0, cheque: 0 } },
            pendingCheques: { count: 0, amount: 0 },
            voided: { count: 0, amount: 0 },
            last: null,
          }),
        ),
    });
    renderRoutes([{ path: '/', element: <ReceiptsSummary params={{ search: '' }} /> }]);
    expect(await screen.findByText('No receipts in this period.')).toBeVisible();
  });

  it('shows nothing (and no error page) when the summary cannot be loaded', async () => {
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/payments/summary': () => json(500, { error: { code: 'error.internal', message: 'x', params: {}, correlationId: 'r' } }),
    });
    const { container } = renderRoutes([{ path: '/', element: <ReceiptsSummary params={{ search: '' }} /> }]);
    await new Promise((r) => setTimeout(r, 80));
    expect(container.querySelector('[data-testid="receipts-summary"]')).toBeNull();
  });
});

describe('Doctor statement (B4): readable lines and the CSV button', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the patient, the voucher and the method with cheque details, and exports with the range', async () => {
    let exportUrl = '';
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': () => json(200, { id: 1, username: 'o', permissions: ['ledger.read', 'exports.run'], mustChangePassword: false }),
      'GET /api/v1/doctors/7/statement': () =>
        json(200, {
          openingBalance: 0,
          periodOpening: 0,
          closing: 13000,
          totals: { debit: 20000, credit: 7000 },
          page: 1,
          pageSize: 25,
          total: 2,
          lines: [
            { date: '2026-11-01', kind: 'case', refId: 5, ref: '1288', debit: 20000, credit: 0, running: 20000, voucher: null, patientName: 'ليلى حداد', method: null, chequeNo: null, bank: null, boundCaseNo: null },
            { date: '2026-11-05', kind: 'payment', refId: 9, ref: '9', debit: 0, credit: 7000, running: 13000, voucher: 'IN-000009', patientName: null, method: 'cheque', chequeNo: 'CH-77', bank: 'بنك فلسطين', boundCaseNo: null },
          ],
        }),
      'GET /api/v1/exports/doctors/7/statement': (req) => {
        exportUrl = new URL(req.url).search;
        return new Response('\uFEFFx', { headers: { 'Content-Disposition': 'attachment; filename="s.csv"', 'X-Export-Rows': '2' } });
      },
    });
    URL.createObjectURL = vi.fn(() => 'blob:s');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const doctor = { id: 7, name: 'د. أحمد سالم' };
    renderRoutes(
      [{ path: '/', element: <Outlet context={doctor} />, children: [{ index: true, element: <DoctorStatementTab /> }] }],
      '/?from=2026-11-01&to=2026-11-30',
    );
    const table = await screen.findByRole('table', { name: 'كشف حساب — د. أحمد سالم' });
    const caseRow = await within(table).findByText('ليلى حداد');
    expect(caseRow.closest('tr')).toHaveTextContent('1288');
    const payment = within(table).getByText('IN-000009').closest('tr')!;
    expect(payment).toHaveTextContent('شيك · CH-77 · بنك فلسطين');
    expect(payment).toHaveTextContent('70.00 ₪');
    expect(screen.getByTestId('statement-closing')).toHaveTextContent('130.00 ₪');

    await userEvent.click(await screen.findByRole('button', { name: 'تصدير CSV' }));
    await waitFor(() => expect(exportUrl).not.toBe(''));
    const q = new URLSearchParams(exportUrl);
    expect(q.get('from')).toBe('2026-11-01');
    expect(q.get('to')).toBe('2026-11-30');
  });
});
