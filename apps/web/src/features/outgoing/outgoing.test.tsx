import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { balanceFixture, settingsFixture } from '@/test/fixtures';
import { envelope, json, renderPage, renderRoutes, stubApi } from '@/test/render';
import type { OutgoingPayment } from './api';
import { CashFlowPanel } from './CashFlowPanel';
import { ExpensesSummary } from './ExpensesSummary';
import { OutgoingForm } from './OutgoingForm';
import { OutgoingPage } from './OutgoingPage';

const DOCTOR = { id: 7, name: 'د. أحمد سالم' };
const RENT = { id: 1, name: 'إيجار', isDoctor: false, active: true, rowVersion: 1 };
const REFUND = { id: 2, name: 'طبيب (استرداد)', isDoctor: true, active: true, rowVersion: 1 };

const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });
const ALL = ['expenses.read', 'expenses.write', 'expenses.void', 'cheques.write', 'ledger.read', 'exports.run'];

const outgoing = (over: Partial<OutgoingPayment> = {}): OutgoingPayment => ({
  id: 1,
  voucherNo: 'OUT-000001',
  kind: 'expense',
  category: { id: 1, name: 'إيجار' },
  doctor: null,
  payee: 'مؤجّر المختبر',
  method: 'cash',
  amount: 150000,
  currencyCode: 'ILS',
  paidAt: '2026-11-10',
  effectiveDate: '2026-11-10',
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

const chequeOut = (over: Partial<NonNullable<OutgoingPayment['cheque']>> = {}) =>
  outgoing({
    id: 2,
    voucherNo: 'OUT-000002',
    method: 'cheque',
    amount: 80000,
    counted: false,
    effectiveDate: null,
    cheque: {
      id: 9,
      chequeNo: '5001',
      bank: 'بنك القدس',
      dueDate: '2026-12-01',
      status: 'pending',
      statusDate: null,
      dueState: 'none',
      allowedStatuses: ['cleared', 'returned'],
      rowVersion: 1,
      ...over,
    },
  });

const page = (items: object[], extra: object = {}) => ({
  page: 1,
  pageSize: 25,
  total: items.length,
  items,
  totals: { counted: 150000, pendingCheques: 80000 },
  ...extra,
});

const categories = () => json(200, { page: 1, pageSize: 100, total: 2, items: [RENT, REFUND] });

const summary = (over: object = {}) => ({
  counted: { amount: 150000, count: 1, byMethod: { cash: 150000, transfer: 0, cheque: 0 } },
  byCategory: [
    { categoryId: 1, name: 'إيجار', kind: 'expense', amount: 100000, count: 1, pendingCheques: { count: 1, amount: 80000 } },
    { categoryId: 2, name: 'طبيب (استرداد)', kind: 'doctor_refund', amount: 50000, count: 1, pendingCheques: { count: 0, amount: 0 } },
  ],
  refunds: 50000,
  pendingCheques: { count: 1, amount: 80000 },
  voided: { count: 0, amount: 0 },
  last: { voucherNo: 'OUT-000002', paidAt: '2026-11-10', amount: 80000 },
  basis: 'effective',
  ...over,
});

const cashFlow = () => ({
  from: '2026-11-01',
  to: '2026-11-19',
  in: { total: 300000, cash: 100000, transfer: 50000, cheque: 150000 },
  out: { total: 200000, cash: 150000, transfer: 0, cheque: 50000, expenses: 150000, refunds: 50000 },
  net: 100000,
});

const common = {
  'GET /api/v1/settings': () => json(200, settingsFixture()),
  'GET /api/v1/expense-categories': categories,
  'GET /api/v1/auth/me': me(ALL),
};

function setup() {
  resetSessionForTests();
  session.set({ accessToken: 't' });
}

/** The amount box: its name starts with the label (the star is decorative). */
const amountBox = () => screen.getByRole('textbox', { name: /^المبلغ/ });
const submit = () => screen.getByRole('button', { name: 'حفظ المصروف' });
const chooseCategory = async (name: string) => {
  const box = await screen.findByRole('combobox', { name: /^الفئة/ });
  await screen.findByRole('option', { name }); // the categories arrive from the API
  await userEvent.selectOptions(box, name);
};

describe('OutgoingForm (SPEC §5.9)', () => {
  beforeEach(async () => {
    setup();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('an expense asks for a payee (no doctor), sends integer minor units with an Idempotency-Key and starts blank again', async () => {
    const keys: (string | null)[] = [];
    const calls = stubApi({
      ...common,
      'POST /api/v1/outgoing-payments': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        return json(201, { payment: outgoing(), doctorBalance: null });
      },
    });
    renderPage(<OutgoingForm />);
    await chooseCategory('إيجار');
    expect(screen.getByRole('textbox', { name: /^المدفوع له/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^الطبيب/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^المدفوع له/ }), 'مؤجّر المختبر');
    await userEvent.type(amountBox(), '1500.50');
    await userEvent.click(submit());
    await waitFor(() => expect(keys).toHaveLength(1));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/outgoing-payments')?.body ?? '{}');
    expect(body).toMatchObject({ categoryId: 1, payee: 'مؤجّر المختبر', method: 'cash', amount: 150050 });
    expect(body.doctorId).toBeUndefined();
    expect(body.cheque).toBeUndefined();
    expect(Number.isInteger(body.amount)).toBe(true);
    await waitFor(() => expect(amountBox()).toHaveValue(''));
    expect(screen.getByRole('combobox', { name: /^الفئة/ })).toHaveValue('');
  });

  it('says what is missing in Arabic and sends nothing', async () => {
    const calls = stubApi(common);
    renderPage(<OutgoingForm />);
    await userEvent.click(submit());
    expect(await screen.findAllByText('هذا الحقل مطلوب.')).not.toHaveLength(0);
    await chooseCategory('إيجار');
    await userEvent.type(amountBox(), '0');
    await userEvent.click(submit());
    expect(await screen.findByText('اكتب اسم المدفوع له.')).toBeInTheDocument();
    expect(screen.getByText('أدخل مبلغًا أكبر من صفر.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/v1/outgoing-payments')).toBe(false);
  });

  it('shows the cheque fields only for a cheque (the lab’s bank, a due date later than today is fine) and sends them', async () => {
    const calls = stubApi({
      ...common,
      'POST /api/v1/outgoing-payments': () => json(201, { payment: chequeOut(), doctorBalance: null }),
    });
    renderPage(<OutgoingForm />);
    await chooseCategory('إيجار');
    expect(screen.queryByRole('textbox', { name: /^رقم الشيك/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'شيك' }));
    await userEvent.type(screen.getByRole('textbox', { name: /^المدفوع له/ }), 'مورّد');
    await userEvent.type(amountBox(), '800');
    await userEvent.click(submit());
    expect(await screen.findByText('أدخل رقم الشيك.')).toBeInTheDocument();
    expect(screen.getByText('أدخل اسم البنك.')).toBeInTheDocument();
    expect(screen.getByText('أدخل تاريخ استحقاق الشيك.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^رقم الشيك/ }), '5001');
    await userEvent.type(screen.getByRole('textbox', { name: /^بنك المختبر/ }), 'بنك القدس');
    await userEvent.type(screen.getByRole('textbox', { name: /^تاريخ الاستحقاق/ }), '20991201');
    await userEvent.click(submit());
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/v1/outgoing-payments')).toBe(true));
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/outgoing-payments')?.body ?? '{}');
    expect(body.cheque).toEqual({ chequeNo: '5001', bank: 'بنك القدس', dueDate: '2099-12-01' });
    expect(body.amount).toBe(80000);
  });

  it('the refund category switches the payee for a doctor and shows his refundable credit; an amount above it is refused with the limit', async () => {
    const calls = stubApi({
      ...common,
      'GET /api/v1/doctors/7/balance': () => json(200, balanceFixture(7, -5000)),
      'POST /api/v1/outgoing-payments': () => json(201, { payment: outgoing(), doctorBalance: -2000 }),
    });
    renderPage(<OutgoingForm refundDoctor={DOCTOR} />);
    expect(screen.queryByRole('textbox', { name: /^المدفوع له/ })).not.toBeInTheDocument();
    expect(await screen.findByText('طبيب (استرداد)')).toBeInTheDocument();
    expect(screen.getByText(DOCTOR.name)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('outgoing-refundable')).toHaveTextContent('50.00 ₪'));
    await userEvent.type(amountBox(), '60');
    await userEvent.click(submit());
    expect(await screen.findByText('المبلغ أكبر من الرصيد القابل للاسترداد (50.00 ₪).')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/v1/outgoing-payments')).toBe(false);
    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), '30');
    await userEvent.click(submit());
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/v1/outgoing-payments')).toBe(true));
    const body = JSON.parse(calls.find((c) => c.key === 'POST /api/v1/outgoing-payments')?.body ?? '{}');
    expect(body).toMatchObject({ categoryId: 2, doctorId: 7, amount: 3000 });
    expect(body.payee).toBeUndefined();
  });

  it('with no credit the refund is refused with the reason, before any request', async () => {
    const calls = stubApi({
      ...common,
      'GET /api/v1/doctors/7/balance': () => json(200, balanceFixture(7, 40000)),
    });
    renderPage(<OutgoingForm refundDoctor={DOCTOR} />);
    await waitFor(() => expect(screen.getByTestId('outgoing-refundable')).toHaveTextContent('0.00 ₪'));
    expect(screen.getByTestId('outgoing-refundable')).toHaveTextContent('لا يوجد رصيد دائن للاسترداد.');
    await userEvent.type(amountBox(), '10');
    await userEvent.click(submit());
    expect(await screen.findAllByText('لا يوجد رصيد دائن للاسترداد.')).not.toHaveLength(0);
    expect(calls.some((c) => c.key === 'POST /api/v1/outgoing-payments')).toBe(false);
  });

  it('shows the server’s refusal, retries with the same key, and a changed request gets a new key', async () => {
    const keys: (string | null)[] = [];
    stubApi({
      ...common,
      'POST /api/v1/outgoing-payments': (req) => {
        keys.push(req.headers.get('Idempotency-Key'));
        return json(409, envelope('error.outgoing.category_inactive', 'هذه الفئة معطّلة ولا تقبل مصاريف جديدة.'));
      },
    });
    renderPage(<OutgoingForm />);
    await chooseCategory('إيجار');
    await userEvent.type(screen.getByRole('textbox', { name: /^المدفوع له/ }), 'مؤجّر');
    await userEvent.type(amountBox(), '50');
    await userEvent.click(submit());
    await waitFor(() => expect(keys).toHaveLength(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('معطّلة');
    await userEvent.click(submit());
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await userEvent.clear(amountBox());
    await userEvent.type(amountBox(), '60');
    await userEvent.click(submit());
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('a double click sends one request', async () => {
    let resolve: (r: Response) => void = () => {};
    const calls = stubApi({
      ...common,
      'POST /api/v1/outgoing-payments': () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    });
    renderPage(<OutgoingForm />);
    await chooseCategory('إيجار');
    await userEvent.type(screen.getByRole('textbox', { name: /^المدفوع له/ }), 'مؤجّر');
    await userEvent.type(amountBox(), '50');
    await userEvent.dblClick(submit());
    await waitFor(() => expect(calls.filter((c) => c.key === 'POST /api/v1/outgoing-payments')).toHaveLength(1));
    resolve(json(201, { payment: outgoing(), doctorBalance: null }));
  });
});

describe('OutgoingPage', () => {
  beforeEach(async () => {
    setup();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  const routes = (extra: Record<string, (req: Request) => Response | Promise<Response>> = {}) => ({
    ...common,
    'GET /api/v1/outgoing-payments': () => json(200, page([outgoing(), chequeOut()])),
    'GET /api/v1/outgoing-payments/summary': () => json(200, summary()),
    'GET /api/v1/ledger/cash-flow': () => json(200, cashFlow()),
    ...extra,
  });
  const mount = (path = '/outgoing') => renderRoutes([{ path: '/outgoing', element: <OutgoingPage /> }], path);

  it('lists expenses and refunds with money in its own column, struck-through void rows with their reason, and the totals', async () => {
    stubApi(
      routes({
        'GET /api/v1/outgoing-payments': () =>
          json(
            200,
            page([
              outgoing(),
              outgoing({
                id: 3,
                voucherNo: 'OUT-000003',
                kind: 'doctor_refund',
                category: { id: 2, name: 'طبيب (استرداد)' },
                doctor: DOCTOR,
                payee: null,
                status: 'void',
                voidReason: 'أُدخل بالخطأ',
                counted: false,
              }),
            ]),
          ),
      }),
    );
    mount();
    const rows = await screen.findByRole('table', { name: 'تقرير المصاريف' });
    const rent = within(rows).getByText('OUT-000001').closest('tr')!;
    expect(rent).toHaveTextContent('مؤجّر المختبر');
    expect(rent).toHaveTextContent('1,500.00 ₪');
    const voided = within(rows).getByText('OUT-000003').closest('tr')!;
    expect(voided).toHaveTextContent('ملغاة: أُدخل بالخطأ');
    expect(within(voided).getByRole('link', { name: DOCTOR.name })).toHaveAttribute('href', '/doctors/7');
    expect(voided).toHaveClass('text-muted');
    expect(screen.getByTestId('outgoing-totals')).toHaveTextContent('1,500.00 ₪');
    expect(screen.getByTestId('outgoing-totals')).toHaveTextContent('800.00 ₪');
  });

  it('shows a loading state, then an empty state with the form, and an error state with a retry', async () => {
    let fail = true;
    stubApi(
      routes({
        'GET /api/v1/outgoing-payments': () =>
          fail ? json(500, envelope('error.internal', 'خطأ داخلي')) : json(200, page([], { totals: { counted: 0, pendingCheques: 0 } })),
      }),
    );
    mount();
    expect(screen.getByRole('status', { name: 'جارٍ التحميل…' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر تحميل المصاريف.');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('لا توجد مصاريف مسجلة بعد.')).toBeInTheDocument();
    // The form is on the page even with no expenses.
    expect(screen.getByRole('form', { name: 'مصروف جديد' })).toBeInTheDocument();
  });

  it('keeps every filter in the address and sends it to the list, the summary and the exports', async () => {
    const lists: string[] = [];
    const sums: string[] = [];
    stubApi(
      routes({
        'GET /api/v1/outgoing-payments': (req) => {
          lists.push(new URL(req.url).search);
          return json(200, page([outgoing()]));
        },
        'GET /api/v1/outgoing-payments/summary': (req) => {
          sums.push(new URL(req.url).search);
          return json(200, summary());
        },
      }),
    );
    const view = mount('/outgoing?category=1&kind=expense&method=cheque&status=void&q=OUT-000001&from=2026-11-01&to=2026-11-30');
    await screen.findByText('OUT-000001');
    await waitFor(() => expect(lists.some((s) => s.includes('categoryId=1') && s.includes('kind=expense') && s.includes('method=cheque') && s.includes('status=void') && s.includes('from=2026-11-01'))).toBe(true));
    // The summary uses the same filters except the status.
    await waitFor(() => expect(sums.some((s) => s.includes('categoryId=1') && s.includes('method=cheque') && !s.includes('status='))).toBe(true));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'النوع' }), 'doctor_refund');
    await waitFor(() => expect(view.router.state.location.search).toContain('kind=doctor_refund'));
    await userEvent.click(screen.getByRole('button', { name: 'مسح التصفية' }));
    await waitFor(() => expect(view.router.state.location.search).toBe(''));
  });

  it('voids with a required reason through the outgoing endpoint, and a void row offers no second void', async () => {
    const bodies: string[] = [];
    stubApi(
      routes({
        'POST /api/v1/outgoing-payments/1/void': async (req) => {
          bodies.push(await req.text());
          return json(200, { payment: outgoing({ status: 'void' }), doctorBalance: null });
        },
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'إلغاء الدفعة OUT-000001' }));
    const dialog = await screen.findByRole('dialog', { name: 'إلغاء الدفعة OUT-000001؟' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء الدفعة' }));
    expect(await within(dialog).findByText('هذا الحقل مطلوب.')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^سبب الإلغاء/ }), 'مكرر');
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء الدفعة' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({ rowVersion: 1, reason: 'مكرر' });
  });

  it('changes an outgoing cheque status through the outgoing-cheques endpoint, offering only what the API allows', async () => {
    const calls = stubApi(
      routes({
        'PATCH /api/v1/outgoing-cheques/9/status': () => json(200, { payment: chequeOut({ status: 'cleared' }), doctorBalance: null }),
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /^تغيير الحالة 5001/ }));
    const dialog = await screen.findByRole('dialog', { name: 'تغيير حالة الشيك 5001' });
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['تم الصرف', 'مرتجع']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ الحالة' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/v1/outgoing-cheques/9/status')).toBe(true));
    expect(calls.some((c) => c.key.includes('/api/v1/cheques/'))).toBe(false);
  });

  it('hides the form, the void and the status actions from a user who may only read', async () => {
    stubApi(routes({ 'GET /api/v1/auth/me': me(['expenses.read']) }));
    mount();
    await screen.findByText('OUT-000001');
    expect(screen.queryByRole('form', { name: 'مصروف جديد' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^إلغاء الدفعة/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^تغيير الحالة/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /تصدير/ })).toBeNull();
  });

  it('offers the two CSV files with their own names, and the expenses one is disabled with its reason when nothing matches', async () => {
    stubApi(
      routes({
        'GET /api/v1/outgoing-payments': () => json(200, page([], { totals: { counted: 0, pendingCheques: 0 } })),
      }),
    );
    mount();
    const list = await screen.findByRole('button', { name: 'تصدير المصاريف CSV' });
    expect(list).toHaveAttribute('aria-disabled', 'true');
    expect(list).toHaveAccessibleDescription('لا توجد بيانات للتصدير بهذه التصفية.');
    expect(screen.getByRole('button', { name: 'تصدير حسب الفئة CSV' })).toBeVisible();
  });
});

describe('ExpensesSummary and CashFlowPanel', () => {
  beforeEach(async () => {
    setup();
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the total, the refunds subtotal apart, per-category rows and the date basis', async () => {
    stubApi({ ...common, 'GET /api/v1/outgoing-payments/summary': () => json(200, summary()) });
    renderPage(<ExpensesSummary filter={{ search: '' }} />);
    const panel = await screen.findByTestId('expenses-summary');
    await waitFor(() => expect(within(panel).getByTestId('expenses-counted')).toHaveTextContent('1,500.00 ₪'));
    expect(within(panel).getByTestId('expenses-refunds')).toHaveTextContent('500.00 ₪');
    const refundRow = panel.querySelector('[data-category="2"]')!;
    expect(refundRow).toHaveTextContent('طبيب (استرداد)');
    expect(refundRow).toHaveTextContent('5');
    expect(panel.querySelector('[data-category="1"]')).toHaveTextContent('800.00 ₪');
    expect(panel).toHaveTextContent('حسب تاريخ الصرف');
  });

  it('says so when nothing was spent, and offers a retry on an error', async () => {
    let fail = true;
    stubApi({
      ...common,
      'GET /api/v1/outgoing-payments/summary': () =>
        fail
          ? json(500, envelope('error.internal', 'x'))
          : json(200, summary({ counted: { amount: 0, count: 0, byMethod: { cash: 0, transfer: 0, cheque: 0 } }, byCategory: [], refunds: 0, pendingCheques: { count: 0, amount: 0 }, last: null })),
    });
    renderPage(<ExpensesSummary filter={{ search: '' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر تحميل ملخص المصاريف.');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('لا توجد مصاريف في هذه الفترة.')).toBeInTheDocument();
  });

  it('cash flow: money in, money out (expenses and refunds apart) and the net, for the period the server used', async () => {
    const seen: string[] = [];
    stubApi({
      ...common,
      'GET /api/v1/ledger/cash-flow': (req) => {
        seen.push(new URL(req.url).search);
        return json(200, cashFlow());
      },
    });
    renderPage(<CashFlowPanel from="2026-11-01" to="" />);
    const panel = await screen.findByTestId('cash-flow');
    await waitFor(() => expect(within(panel).getByTestId('cash-in')).toHaveTextContent('3,000.00 ₪'));
    expect(within(panel).getByTestId('cash-out')).toHaveTextContent('2,000.00 ₪');
    expect(within(panel).getByTestId('cash-net')).toHaveTextContent('1,000.00 ₪');
    expect(panel).toHaveTextContent('2026-11-19');
    expect(seen[0]).toBe('?from=2026-11-01');
  });

  it('cash flow is not shown to a user without ledger.read, and no request is made', async () => {
    const calls = stubApi({ ...common, 'GET /api/v1/auth/me': me(['expenses.read']) });
    renderPage(<CashFlowPanel from="" to="" />);
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/v1/auth/me')).toBe(true));
    expect(screen.queryByTestId('cash-flow')).toBeNull();
    expect(calls.some((c) => c.key === 'GET /api/v1/ledger/cash-flow')).toBe(false);
  });
});

describe('OutgoingForm in English', () => {
  beforeEach(async () => {
    setup();
    await initI18n('en');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the English words for the fields and the refund limit', async () => {
    stubApi({
      ...common,
      'GET /api/v1/doctors/7/balance': () => json(200, balanceFixture(7, -5000)),
    });
    renderPage(<OutgoingForm refundDoctor={DOCTOR} />);
    await waitFor(() => expect(screen.getByTestId('outgoing-refundable')).toHaveTextContent('Refundable credit'));
    await userEvent.type(screen.getByRole('textbox', { name: /^Amount/ }), '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('The amount is more than the refundable credit (50.00 ₪).')).toBeInTheDocument();
  });
});
