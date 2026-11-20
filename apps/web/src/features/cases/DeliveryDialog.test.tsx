import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { emptyCasePayments, settingsFixture } from '@/test/fixtures';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import type { CaseDetail } from './api';
import { CaseDetailsPage } from './CaseDetailsPage';

const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  id: 41,
  caseNo: 1288,
  doctor: { id: 7, name: 'د. أحمد سالم' },
  patientName: 'ليلى حداد',
  technician: null,
  receivedDate: '2026-11-01',
  expectedDate: '2026-11-05',
  deliveredDate: null,
  collectOn: null,
  status: 'ready',
  total: 47000,
  overdue: false,
  rowVersion: 4,
  subtotal: 47000,
  paid: 0,
  remaining: 47000,
  pendingCheques: 0,
  deliveryDue: 47000,
  collectDue: false,
  discount: 0,
  notes: null,
  lines: [],
  history: [],
  allowedStatuses: ['waiting', 'design', 'in_progress', 'delivered'],
  canCancel: true,
  canEdit: true,
  ...over,
});
const delivered = (over: Partial<CaseDetail> = {}) =>
  detail({
    status: 'delivered',
    deliveredDate: '2026-11-03',
    deliveryDue: null,
    rowVersion: 5,
    allowedStatuses: ['returned'],
    canCancel: false,
    ...over,
  });
const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });
const ALL = ['cases.read', 'cases.write', 'payments.write', 'ledger.read', 'notifications.read'];

function api(over: Record<string, (req: Request) => Response | Promise<Response>> = {}) {
  return stubApi({
    'GET /api/v1/auth/me': me(ALL),
    'GET /api/v1/cases/41/payments': () => json(200, emptyCasePayments(41, 47000)),
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/cases': () => json(200, { page: 1, pageSize: 25, total: 0, items: [] }),
    'GET /api/v1/cases/41': () => json(200, detail()),
    ...over,
  });
}
const renderCase = () => renderRoutes([{ path: '/cases/:id', element: <CaseDetailsPage /> }], '/cases/41');

async function openDelivery() {
  renderCase();
  await userEvent.click(await screen.findByRole('button', { name: 'تسليم الحالة' }));
  return screen.findByRole('dialog', { name: 'تسليم الحالة رقم 1288' });
}

describe('DeliveryDialog (B5)', () => {
  beforeEach(async () => {
    vi.spyOn(toast, 'success');
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  /** No Toaster is mounted in component tests: the toast call is the observable. */
  const toasted = (text: string | RegExp) =>
    waitFor(() =>
      expect(vi.mocked(toast.success).mock.calls.map((c) => c[0] as string)).toContainEqual(
        typeof text === 'string' ? text : expect.stringMatching(text),
      ),
    );

  it('choosing «تم التسليم» in the status dialog continues in the delivery dialog', async () => {
    api();
    renderCase();
    await userEvent.click(await screen.findByRole('button', { name: 'تغيير المرحلة' }));
    const status = await screen.findByRole('dialog', { name: 'تغيير مرحلة الحالة' });
    await userEvent.click(within(status).getByRole('radio', { name: 'تم التسليم' }));
    expect(within(status).getByRole('note')).toHaveTextContent('التسليم خطوة مستقلة');
    await userEvent.click(within(status).getByRole('button', { name: 'متابعة إلى التسليم' }));
    expect(await screen.findByRole('dialog', { name: 'تسليم الحالة رقم 1288' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'تغيير مرحلة الحالة' })).not.toBeInTheDocument();
  });

  it('asks what was received; part payment needs an amount below the amount due and a collect date (Arabic errors)', async () => {
    const calls = api();
    const dialog = await openDelivery();
    expect(within(dialog).getByTestId('delivery-due')).toHaveTextContent('470.00 ₪');
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    expect(await within(dialog).findByText('اختر ماذا استلمت.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'جزءًا من المبلغ' }));
    const amount = within(dialog).getByRole('textbox', { name: /^المبلغ المستلَم/ });
    await userEvent.type(amount, '470');
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    expect(amount).toHaveAccessibleDescription(/المبلغ الجزئي أقل من المستحق/);
    const collect = within(dialog).getByRole('textbox', { name: 'موعد تحصيل الباقي' });
    expect(collect).toHaveAttribute('aria-invalid', 'true');
    expect(collect).toHaveAccessibleDescription('حدّد موعد تحصيل الباقي.');
    expect(calls.some((c) => c.key === 'POST /api/v1/cases/41/delivery')).toBe(false);
  });

  it('nothing received: sends the collect date and no money, with no Idempotency-Key', async () => {
    const keys: (string | null)[] = [];
    const calls = api({
      'POST /api/v1/cases/41/delivery': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        return json(200, { case: delivered({ collectOn: '2026-12-01' }), payment: null, doctorBalance: null });
      },
    });
    const dialog = await openDelivery();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'لا، لم أستلم شيئًا' }));
    expect(within(dialog).queryByRole('radio', { name: 'نقدًا' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'موعد تحصيل الباقي' }), '20261201');
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    await toasted('تم تسليم الحالة رقم 1288.');
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/cases/41/delivery')?.body ?? '{}');
    expect(body).toEqual({ rowVersion: 4, deliveredDate: expect.any(String), received: 'none', collectOn: '2026-12-01' });
    expect(keys).toEqual([null]);
  });

  it('full by cheque: no amount is sent (the server computes it), the cheque fields are required, one key per attempt', async () => {
    const keys: (string | null)[] = [];
    let fail = true;
    const calls = api({
      'POST /api/v1/cases/41/delivery': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        if (fail) {
          fail = false;
          return json(500, envelope('error.internal', 'خطأ غير متوقع.'));
        }
        return json(200, {
          case: delivered(),
          payment: { voucherNo: 'IN-000031', method: 'cheque' },
          doctorBalance: 47000,
        });
      },
    });
    const dialog = await openDelivery();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'نعم، المبلغ كاملًا (⁦470.00 ₪⁩)' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'شيك' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    const chequeNo = within(dialog).getByRole('textbox', { name: 'رقم الشيك' });
    await waitFor(() => expect(chequeNo).toHaveAttribute('aria-invalid', 'true'));
    await userEvent.type(chequeNo, '778899');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'البنك' }), 'بنك فلسطين');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'تاريخ الاستحقاق' }), '20261215');
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    // The first attempt failed on the server; the retry of the same request reuses its key.
    await waitFor(() => expect(keys).toHaveLength(1));
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    await toasted(/^تم تسليم الحالة رقم 1288 وتسجيل الدفعة ⁦IN-000031⁩. الرصيد الجديد: ⁦470.00 ₪⁩./);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    const body = JSON.parse(calls.filter((c) => c.key === 'POST /api/v1/cases/41/delivery').at(-1)?.body ?? '{}');
    expect(body).toEqual({
      rowVersion: 4,
      deliveredDate: expect.any(String),
      received: 'full',
      method: 'cheque',
      cheque: { chequeNo: '778899', bank: 'بنك فلسطين', dueDate: '2026-12-15' },
    });
  });

  it('puts a server refusal on its field, in the server words', async () => {
    api({
      'POST /api/v1/cases/41/delivery': () =>
        json(409, envelope('error.delivery.exceeds_remaining', 'المبلغ أكبر من المستحق على الحالة عند التسليم.')),
    });
    const dialog = await openDelivery();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'جزءًا من المبلغ' }));
    const amount = within(dialog).getByRole('textbox', { name: /^المبلغ المستلَم/ });
    await userEvent.type(amount, '100');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'موعد تحصيل الباقي' }), '20991231');
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    await waitFor(() => expect(amount).toHaveAccessibleDescription('المبلغ أكبر من المستحق على الحالة عند التسليم.'));
  });

  it('a fully paid case is delivered without the money question; pending cheques are shown as a note', async () => {
    const calls = api({
      'GET /api/v1/cases/41': () => json(200, detail({ deliveryDue: 0, pendingCheques: 47000, remaining: 47000 })),
      'POST /api/v1/cases/41/delivery': () => json(200, { case: delivered(), payment: null, doctorBalance: null }),
    });
    const dialog = await openDelivery();
    expect(within(dialog).getByTestId('delivery-due')).toHaveTextContent('الحالة مدفوعة بالكامل');
    expect(within(dialog).getByTestId('delivery-due')).toHaveTextContent('(⁦470.00 ₪⁩) لا تُطلب مرة أخرى');
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'تسليم الحالة' }));
    await toasted('تم تسليم الحالة رقم 1288.');
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/cases/41/delivery')?.body ?? '{}');
    expect(body).toEqual({ rowVersion: 4, deliveredDate: expect.any(String) });
  });

  it('without payments.write only «nothing received» is offered', async () => {
    api({ 'GET /api/v1/auth/me': me(['cases.read', 'cases.write']) });
    const dialog = await openDelivery();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    expect(within(dialog).getByRole('radio', { name: 'لا، لم أستلم شيئًا' })).toBeChecked();
    expect(within(dialog).getByText(/تسجيل المبالغ يحتاج صلاحية الدفعات/)).toBeInTheDocument();
  });

  it('Escape closes the dialog and gives the focus back to «تسليم الحالة»', async () => {
    api();
    const dialog = await openDelivery();
    expect(dialog).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'تسليم الحالة' })).toHaveFocus();
  });

  it('a delivered case shows its collect date, «تحصيل مستحق», and the date can be changed or removed', async () => {
    const calls = api({
      'GET /api/v1/cases/41': () => json(200, delivered({ collectOn: '2026-11-04', collectDue: true })),
      'PATCH /api/v1/cases/41/collect-on': () => json(200, delivered({ collectOn: null, rowVersion: 6 })),
    });
    renderCase();
    expect(await screen.findByText('تحصيل مستحق')).toBeInTheDocument();
    expect(screen.getByText('2026-11-04')).toBeInTheDocument();
    const deliver = screen.getByRole('button', { name: 'تسليم الحالة' });
    expect(deliver).toHaveAttribute('aria-disabled', 'true');
    expect(deliver).toHaveAccessibleDescription('هذه الحالة مسلّمة بالفعل.');
    await userEvent.click(screen.getByRole('button', { name: 'تعديل موعد التحصيل' }));
    const dialog = await screen.findByRole('dialog', { name: 'موعد تحصيل الباقي' });
    const field = within(dialog).getByRole('textbox', { name: 'الموعد' });
    await userEvent.clear(field);
    await userEvent.type(field, '20261101');
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(field).toHaveAccessibleDescription('موعد التحصيل لا يسبق تاريخ التسليم.'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'حذف الموعد' }));
    await toasted('تم حذف موعد التحصيل.');
    expect(JSON.parse(calls.find((c) => c.key === 'PATCH /api/v1/cases/41/collect-on')?.body ?? '{}')).toEqual({
      rowVersion: 5,
      collectOn: null,
    });
  });
});
