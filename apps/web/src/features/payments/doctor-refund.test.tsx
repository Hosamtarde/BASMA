import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { balanceFixture, settingsFixture } from '@/test/fixtures';
import { json, renderPage, stubApi } from '@/test/render';
import { DoctorBalanceCard } from './DoctorTabs';

const DOCTOR = { id: 7, name: 'د. أحمد سالم' };
const REFUND = { id: 2, name: 'طبيب (استرداد)', isDoctor: true, active: true, rowVersion: 1 };

const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });

const base = (permissions = ['expenses.write', 'ledger.read']) => ({
  'GET /api/v1/settings': () => json(200, settingsFixture()),
  'GET /api/v1/auth/me': me(permissions),
  'GET /api/v1/expense-categories': () => json(200, { page: 1, pageSize: 100, total: 1, items: [REFUND] }),
});

describe('«استرداد رصيد» on the doctor page (SPEC §5.9)', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is limited to the refundable credit: with credit it opens the form with the category and the doctor fixed', async () => {
    stubApi({ ...base(), 'GET /api/v1/doctors/7/balance': () => json(200, { ...balanceFixture(7, -5000), paidOut: 2000 }) });
    renderPage(<DoctorBalanceCard doctor={DOCTOR} />);
    const action = await screen.findByRole('button', { name: 'استرداد رصيد' });
    await waitFor(() => expect(action).not.toBeDisabled());
    expect(action).not.toHaveAttribute('aria-disabled');
    // The balance card also says what was already refunded to him.
    await waitFor(() => expect(screen.getByTestId('balance-paid-out')).toHaveTextContent('20.00 ₪'));
    await userEvent.click(action);
    const dialog = await screen.findByRole('dialog', { name: 'استرداد رصيد إلى د. أحمد سالم' });
    expect(await within(dialog).findByText('طبيب (استرداد)')).toBeVisible();
    await waitFor(() => expect(within(dialog).getByTestId('outgoing-refundable')).toHaveTextContent('50.00 ₪'));
    expect(within(dialog).queryByRole('combobox')).toBeNull(); // no category box, no doctor picker
  });

  it('with nothing refundable it stays visible, says why, and opens nothing', async () => {
    stubApi({ ...base(), 'GET /api/v1/doctors/7/balance': () => json(200, balanceFixture(7, 40000)) });
    renderPage(<DoctorBalanceCard doctor={DOCTOR} />);
    const action = await screen.findByRole('button', { name: 'استرداد رصيد' });
    await waitFor(() => expect(action).toHaveAttribute('aria-disabled', 'true'));
    expect(action).toHaveAccessibleDescription('لا يوجد رصيد دائن للاسترداد.');
    await userEvent.click(action);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a credit fully reserved by refund cheques is not refundable either, and the card shows the pending refund cheques', async () => {
    stubApi({
      ...base(),
      'GET /api/v1/doctors/7/balance': () => json(200, { ...balanceFixture(7, -5000), refundable: 0, pendingRefundCheques: 5000 }),
    });
    renderPage(<DoctorBalanceCard doctor={DOCTOR} />);
    const action = await screen.findByRole('button', { name: 'استرداد رصيد' });
    await waitFor(() => expect(action).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByTestId('balance-pending-refunds')).toHaveTextContent('50.00 ₪');
  });

  it('is not offered to someone who may not write expenses or read the ledger', async () => {
    stubApi({ ...base(['expenses.write']), 'GET /api/v1/doctors/7/balance': () => json(200, balanceFixture(7, -5000)) });
    renderPage(<DoctorBalanceCard doctor={DOCTOR} />);
    await waitFor(() => expect(screen.getByTestId('doctor-balance')).toHaveTextContent('50.00 ₪'));
    expect(screen.queryByRole('button', { name: 'استرداد رصيد' })).toBeNull();
  });
});
