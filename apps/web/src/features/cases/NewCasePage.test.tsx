import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { NewCasePage } from './NewCasePage';

const page = (items: object[]) => ({ page: 1, pageSize: 25, total: items.length, items });
const zircon = { id: 3, name: 'زيركون', unitPrice: 25000, sortOrder: 0, active: true, rowVersion: 1 };
const doctor = {
  id: 7,
  name: 'د. أحمد سالم',
  phone: null,
  clinic: null,
  notes: null,
  openingBalance: 0,
  active: true,
  rowVersion: 1,
};
const savedCase = {
  id: 41,
  caseNo: 1288,
  doctor: { id: 7, name: doctor.name },
  patientName: 'ليلى حداد',
  technician: null,
  receivedDate: '2026-11-07',
  expectedDate: '2099-01-01',
  deliveredDate: null,
  status: 'design',
  total: 41950,
  overdue: false,
  rowVersion: 1,
  subtotal: 41950,
  discount: 0,
  notes: null,
  lines: [],
  history: [],
  allowedStatuses: [],
  canCancel: true,
  canEdit: true,
};

function api(overrides: Record<string, (req: Request) => Response | Promise<Response>> = {}) {
  return stubApi({
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/work-types': () => json(200, page([zircon])),
    'GET /api/v1/doctors': () => json(200, page([doctor])),
    'GET /api/v1/doctors/7/prices': () =>
      json(200, [{ workTypeId: 3, workTypeName: 'زيركون', workTypeActive: true, generalPrice: 25000, specialPrice: 22000 }]),
    'GET /api/v1/technicians': () => json(200, page([])),
    'POST /api/v1/cases': () => json(201, savedCase),
    ...overrides,
  });
}

const renderNewCase = () =>
  renderRoutes(
    [
      { path: '/cases/new', element: <NewCasePage /> },
      { path: '/cases/:id', element: <p>case page</p> },
      { path: '/cases', element: <p>cases list</p> },
    ],
    '/cases/new',
  );

async function pick(label: string, option: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('NewCasePage', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    localStorage.clear();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('without work types shows the SPEC message and opens the work-types manager', async () => {
    api({ 'GET /api/v1/work-types': () => json(200, page([])) });
    renderNewCase();
    expect(await screen.findByText('أضف نوع عمل واحدًا على الأقل أولًا، ثم أعد فتح "إضافة حالة".')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'أنواع العمل' })).toBeInTheDocument();
  });

  it('shows the required fields in Arabic and asks for teeth and a work type before adding work', async () => {
    api();
    renderNewCase();
    await userEvent.click(await screen.findByRole('button', { name: 'حفظ الحالة' }));
    const doctorBox = screen.getByRole('combobox', { name: 'الطبيب' });
    await waitFor(() => expect(doctorBox).toHaveAttribute('aria-invalid', 'true'));
    expect(doctorBox).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    expect(screen.getByRole('textbox', { name: 'اسم المريض' })).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    expect(screen.getByRole('textbox', { name: 'التسليم المتوقع' })).toHaveAccessibleDescription('هذا الحقل مطلوب.');

    await userEvent.click(screen.getByRole('button', { name: /^إضافة العمل للأسنان المحددة/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('اختر نوع العمل أولًا.');
  });

  it('adds one line per tooth with a preview price, sends only typed prices, and offers the next steps', async () => {
    const calls = api();
    renderNewCase();
    await screen.findByRole('button', { name: 'حفظ الحالة' });
    await pick('الطبيب', /د. أحمد سالم/);
    await userEvent.type(screen.getByRole('textbox', { name: 'اسم المريض' }), 'ليلى حداد');

    await userEvent.click(screen.getByRole('checkbox', { name: /^سن 13،/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^سن 23،/ }));
    await pick('نوع العمل', /زيركون/);
    await userEvent.click(screen.getByRole('button', { name: /^اللون/ }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'اختيار اللون' })).getByRole('button', { name: 'A2' }));
    await userEvent.click(screen.getByRole('button', { name: 'إضافة العمل للأسنان المحددة (2)' }));

    const table = screen.getByRole('table', { name: 'سطور العمل' });
    await waitFor(() => expect(within(table).getAllByText('★ سعر خاص')).toHaveLength(2));
    expect(within(table).getAllByText('220.00 ₪')).toHaveLength(2);
    // The teeth now show the work and the selection was cleared.
    expect(screen.getByRole('checkbox', { name: 'سن 13، ناب علوي يمين، عليه: زيركون' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'سعر يدوي لـ سن 23 · زيركون' }), '199.5');
    expect(screen.getByTestId('draft-total')).toHaveTextContent('419.50 ₪');
    await userEvent.type(screen.getByRole('textbox', { name: 'التسليم المتوقع' }), '20990101');

    await userEvent.click(screen.getByRole('button', { name: 'حفظ الحالة' }));
    expect(await screen.findByRole('heading', { name: 'تم حفظ الحالة رقم 1288.' })).toBeInTheDocument();
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/cases')?.body ?? '{}');
    expect(body).toMatchObject({
      doctorId: 7,
      patientName: 'ليلى حداد',
      technicianId: null,
      expectedDate: '2099-01-01',
      status: 'design',
      discount: 0,
      notes: null,
      lines: [
        { workTypeId: 3, shade: 'A2', toothNo: 13 },
        { workTypeId: 3, shade: 'A2', toothNo: 23, unitPrice: 19950 },
      ],
    });
    // The previewed special price is never sent as truth.
    expect(body.lines[0]).not.toHaveProperty('unitPrice');
    expect(screen.getByRole('link', { name: 'فتح الحالة' })).toHaveAttribute('href', '/cases/41');
    await userEvent.click(screen.getByRole('button', { name: 'إضافة حالة أخرى' }));
    expect(screen.getByRole('textbox', { name: 'اسم المريض' })).toHaveValue('');
  });

  it('puts a date rule from the server on its field, in the server words', async () => {
    api({
      'POST /api/v1/cases': () =>
        json(
          400,
          envelope(
            'error.case.expected_before_received',
            'تاريخ التسليم المتوقع يجب أن يكون في تاريخ الاستلام أو بعده.',
          ),
        ),
    });
    renderNewCase();
    await screen.findByRole('button', { name: 'حفظ الحالة' });
    await pick('الطبيب', /د. أحمد سالم/);
    await userEvent.type(screen.getByRole('textbox', { name: 'اسم المريض' }), 'سامي');
    await pick('نوع العمل', /زيركون/);
    await userEvent.click(screen.getByRole('button', { name: 'الفكّان' }));
    expect(screen.getByRole('table', { name: 'سطور العمل' })).toHaveTextContent('الفكان');
    await userEvent.type(screen.getByRole('textbox', { name: 'التسليم المتوقع' }), '20990101');
    await userEvent.click(screen.getByRole('button', { name: 'حفظ الحالة' }));
    const expected = screen.getByRole('textbox', { name: 'التسليم المتوقع' });
    await waitFor(() => expect(expected).toHaveAttribute('aria-invalid', 'true'));
    expect(expected).toHaveAccessibleDescription('تاريخ التسليم المتوقع يجب أن يكون في تاريخ الاستلام أو بعده.');
  });
});
