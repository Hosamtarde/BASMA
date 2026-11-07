import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import type { CaseDetail } from './api';
import { CaseDetailsPage } from './CaseDetailsPage';

const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  id: 41,
  caseNo: 1288,
  doctor: { id: 7, name: 'د. أحمد سالم' },
  patientName: 'ليلى حداد',
  technician: { id: 2, name: 'فادي' },
  receivedDate: '2026-11-01',
  expectedDate: '2026-11-05',
  deliveredDate: null,
  status: 'design',
  total: 47000,
  overdue: true,
  rowVersion: 4,
  subtotal: 50000,
  discount: 3000,
  notes: 'لون فاتح',
  lines: [
    {
      id: 90,
      toothNo: 13,
      area: null,
      workTypeId: 3,
      workTypeName: 'زيركون',
      shade: 'A2',
      unitPrice: 22000,
      priceSource: 'special',
      note: null,
    },
    {
      id: 91,
      toothNo: null,
      area: 'upper_arch',
      workTypeId: 5,
      workTypeName: 'طقم',
      shade: null,
      unitPrice: 28000,
      priceSource: 'general',
      note: null,
    },
  ],
  history: [
    { fromStatus: null, toStatus: 'waiting', at: '2026-11-01T08:00:00Z', note: null, deliveredDate: null },
    {
      fromStatus: 'waiting',
      toStatus: 'design',
      at: '2026-11-02T09:30:00Z',
      note: 'بدأ التصميم',
      deliveredDate: null,
    },
  ],
  allowedStatuses: ['waiting', 'in_progress', 'ready', 'delivered'],
  canCancel: true,
  canEdit: true,
  ...over,
});

const renderCase = () => renderRoutes([{ path: '/cases/:id', element: <CaseDetailsPage /> }], '/cases/41');

describe('CaseDetailsPage', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the header, lines with price sources, totals, notes and the history (newest first)', async () => {
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cases/41': () => json(200, detail()),
    });
    renderCase();
    expect(await screen.findByRole('heading', { name: 'الحالة رقم 1288', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('متأخرة')).toBeInTheDocument();
    const lines = screen.getByRole('table', { name: 'سطور العمل' });
    expect(within(lines).getByText('★ سعر خاص')).toBeInTheDocument();
    expect(within(lines).getByText('الفك العلوي')).toBeInTheDocument();
    expect(screen.getByTestId('case-total')).toHaveTextContent('470.00 ₪');
    expect(screen.getByText('لون فاتح')).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('من «بالانتظار» إلى «قيد التصميم»');
    expect(items[0]).toHaveTextContent('2026-11-02 11:30'); // lab time zone (Asia/Hebron)
    expect(items[1]).toHaveTextContent('إنشاء الحالة على مرحلة «بالانتظار»');
  });

  it('offers only the statuses the API allows; edit and cancel stay visible, disabled, with the reason', async () => {
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cases/41': () =>
        json(
          200,
          detail({ status: 'delivered', allowedStatuses: ['returned'], canCancel: false, canEdit: false }),
        ),
    });
    renderCase();
    await userEvent.click(await screen.findByRole('button', { name: 'تغيير المرحلة' }));
    const dialog = await screen.findByRole('dialog', { name: 'تغيير مرحلة الحالة' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    expect(within(dialog).getByRole('radio', { name: 'مرتجعة للتعديل' })).toBeChecked();
    await userEvent.keyboard('{Escape}');
    const cancel = screen.getByRole('button', { name: 'إلغاء الحالة' });
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(cancel).toHaveAccessibleDescription('يمكن إلغاء الحالة قبل التسليم فقط.');
    const edit = screen.getByRole('button', { name: 'تعديل البيانات' });
    expect(edit).toHaveAttribute('aria-disabled', 'true');
    expect(edit).toHaveAccessibleDescription('لا يمكن تعديل هذه الحالة الآن.');
    // A disabled action does nothing.
    await userEvent.click(cancel);
    await userEvent.click(edit);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إضافة سطور' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^تعديل السطر/ })).not.toBeInTheDocument();
  });

  it('changes the status with the version that was read, and the actions follow the answer', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cases': () => json(200, { page: 1, pageSize: 25, total: 0, items: [] }),
      'GET /api/v1/cases/41': () => json(200, detail()),
      'POST /api/v1/cases/41/status': () =>
        json(
          200,
          detail({
            status: 'delivered',
            deliveredDate: '2026-11-03',
            rowVersion: 5,
            allowedStatuses: ['returned'],
            canCancel: false,
          }),
        ),
      'POST /api/v1/cases/41/cancel': () => json(200, detail({ status: 'cancelled', rowVersion: 7 })),
    });
    renderCase();
    await userEvent.click(await screen.findByRole('button', { name: 'تغيير المرحلة' }));
    const dialog = await screen.findByRole('dialog', { name: 'تغيير مرحلة الحالة' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'تم التسليم' }));
    const delivered = within(dialog).getByRole('textbox', { name: 'تاريخ التسليم' });
    await userEvent.clear(delivered);
    await userEvent.type(delivered, '20261103');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'ملاحظة' }), 'سُلّمت للطبيب');
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('تم التسليم'),
    );
    expect(JSON.parse(calls.find((c) => c.key === 'POST /api/v1/cases/41/status')?.body ?? '{}')).toEqual({
      rowVersion: 4,
      to: 'delivered',
      note: 'سُلّمت للطبيب',
      deliveredDate: '2026-11-03',
    });
    // The answer said no cancel any more: the button turns disabled (no client-side lifecycle rule).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'إلغاء الحالة' })).toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('cancels with a required reason, sending the version that was read', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cases': () => json(200, { page: 1, pageSize: 25, total: 0, items: [] }),
      'GET /api/v1/cases/41': () => json(200, detail({ rowVersion: 9 })),
      'POST /api/v1/cases/41/cancel': () =>
        json(
          200,
          detail({
            status: 'cancelled',
            rowVersion: 10,
            allowedStatuses: [],
            canCancel: false,
            canEdit: false,
          }),
        ),
    });
    renderCase();
    await userEvent.click(await screen.findByRole('button', { name: 'إلغاء الحالة' }));
    const dialog = await screen.findByRole('dialog', { name: 'إلغاء الحالة رقم 1288؟' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء الحالة' }));
    const reason = within(dialog).getByRole('textbox', { name: 'سبب الإلغاء' });
    await waitFor(() => expect(reason).toHaveAttribute('aria-invalid', 'true'));
    expect(reason).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    await userEvent.type(reason, 'طلب الطبيب');
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء الحالة' }));
    expect(await screen.findByText('هذه الحالة ملغاة، ولا يمكن تعديلها.')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.key === 'POST /api/v1/cases/41/cancel')?.body ?? '{}')).toEqual({
      rowVersion: 9,
      reason: 'طلب الطبيب',
    });
    const change = screen.getByRole('button', { name: 'تغيير المرحلة' });
    expect(change).toHaveAttribute('aria-disabled', 'true');
    expect(change).toHaveAccessibleDescription('الحالة ملغاة ولا يمكن تغييرها.');
  });

  it('edits only the changed header fields, then a line, each with the latest version', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cases': () => json(200, { page: 1, pageSize: 25, total: 0, items: [] }),
      'GET /api/v1/cases/41': () => json(200, detail()),
      'PATCH /api/v1/cases/41': () => json(200, detail({ patientName: 'ليلى ح.', rowVersion: 5 })),
      'PATCH /api/v1/cases/41/lines/90': () => json(200, detail({ patientName: 'ليلى ح.', rowVersion: 6 })),
    });
    renderCase();
    await userEvent.click(await screen.findByRole('button', { name: 'تعديل البيانات' }));
    const dialog = await screen.findByRole('dialog', { name: 'تعديل بيانات الحالة' });
    const patient = within(dialog).getByRole('textbox', { name: 'اسم المريض' });
    await userEvent.clear(patient);
    await userEvent.type(patient, 'ليلى ح.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(calls.find((c) => c.key === 'PATCH /api/v1/cases/41')?.body ?? '{}')).toEqual({
      rowVersion: 4,
      patientName: 'ليلى ح.',
    });

    await userEvent.click(screen.getByRole('button', { name: 'تعديل السطر: سن 13 · زيركون' }));
    const lineDialog = await screen.findByRole('dialog', { name: 'تعديل السطر' });
    const price = within(lineDialog).getByRole('textbox', { name: 'سعر الوحدة' });
    await userEvent.clear(price);
    await userEvent.type(price, '210');
    await userEvent.click(within(lineDialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/v1/cases/41/lines/90')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.key === 'PATCH /api/v1/cases/41/lines/90')?.body ?? '{}')).toEqual({
      rowVersion: 5,
      unitPrice: 21000,
    });
  });
});
