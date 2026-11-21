import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INVOICE_TEMPLATE, groupInvoiceLines, invoiceTotals, layoutOf, PRODUCT_NAME } from '@app/shared';
import type { CasesInvoiceSnapshot, FreeInvoiceSnapshot, StatementInvoiceSnapshot } from '@app/shared';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { InvoiceDocument, pageRule, safeStyle } from './document/InvoiceDocument';
import { InvoiceAppearancePage } from './InvoiceAppearancePage';
import { InvoicePage } from './InvoicePage';
import { NewInvoicePage } from './NewInvoicePage';

const me = (permissions: string[]) => () => json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });
const ALL = ['invoices.read', 'invoices.write', 'invoices.void', 'cases.read', 'ledger.read', 'settings.read', 'settings.write', 'exports.run'];

const lab = { nameAr: 'مختبر الاختبار', nameEn: 'Test Lab', phone: '02 222 3333', address: 'الخليل', slogan: null, logo: null };

function casesSnapshot(over: Partial<CasesInvoiceSnapshot> = {}): CasesInvoiceSnapshot {
  const lines = groupInvoiceLines([
    { caseNo: 1024, patientName: 'ليلى حداد', workTypeName: 'زيركون', shade: 'A2', unitPrice: 15000, toothNo: 21, area: null },
    { caseNo: 1024, patientName: 'ليلى حداد', workTypeName: 'زيركون', shade: 'A2', unitPrice: 15000, toothNo: 11, area: null },
    { caseNo: 1031, patientName: 'محمود ناصر', workTypeName: 'طقم', shade: null, unitPrice: 20000, toothNo: null, area: 'upper_arch' },
  ]);
  const totals = invoiceTotals(lines, 2000);
  return {
    version: 1,
    type: 'cases',
    no: 1001,
    issueDate: '2026-11-20',
    language: 'ar',
    lab,
    currency: { code: 'ILS', symbol: '₪', decimals: 2 },
    party: { kind: 'doctor', doctorId: 7, name: 'د. أحمد سالم', clinic: 'عيادة الابتسامة', phone: '0599000000' },
    layout: layoutOf(DEFAULT_INVOICE_TEMPLATE),
    notes: 'شكرًا',
    cases: [
      { caseNo: 1024, patientName: 'ليلى حداد', receivedDate: '2026-11-01', deliveredDate: '2026-11-10', status: 'delivered', subtotal: 30000, discount: 0, total: 30000, paid: 0, remaining: 30000 },
      { caseNo: 1031, patientName: 'محمود ناصر', receivedDate: '2026-11-02', deliveredDate: null, status: 'ready', subtotal: 20000, discount: 2000, total: 18000, paid: 0, remaining: 18000 },
    ],
    lines,
    totals,
    balances: { previous: -18000, current: totals.total - 18000, pendingCheques: 0 },
    ...over,
  };
}

const statementSnapshot = (): StatementInvoiceSnapshot => {
  const base = casesSnapshot();
  return {
    version: 1,
    type: 'statement',
    no: 1002,
    issueDate: base.issueDate,
    language: 'ar',
    lab,
    currency: base.currency,
    party: base.party,
    layout: base.layout,
    notes: null,
    statement: {
      from: null,
      to: null,
      openingBalance: 10000,
      periodOpening: 10000,
      lines: [
        { date: '2026-11-01', kind: 'case', ref: '1024', patientName: 'ليلى حداد', method: null, chequeNo: null, bank: null, boundCaseNo: null, debit: 30000, credit: 0, running: 40000 },
        { date: '2026-11-05', kind: 'payment', ref: 'IN-000001', patientName: null, method: 'cash', chequeNo: null, bank: null, boundCaseNo: 1024, debit: 0, credit: 50000, running: -10000 },
      ],
      totals: { debit: 30000, credit: 50000 },
      closing: -10000,
      pendingCheques: 0,
    },
  };
};

const freeSnapshot = (): FreeInvoiceSnapshot => {
  const base = casesSnapshot();
  return {
    version: 1,
    type: 'free',
    no: 1003,
    issueDate: base.issueDate,
    language: 'ar',
    lab,
    currency: base.currency,
    party: { kind: 'free', name: 'عيادة زائرة' },
    layout: base.layout,
    notes: null,
    free: { reason: 'أجرة توصيل', amount: 2500 },
    totals: { subtotal: 2500, discount: 0, total: 2500 },
  };
};

const doc = () => document.querySelector('[data-invoice-document]') as HTMLElement;

describe('InvoiceDocument — the printing renderer', () => {
  beforeEach(async () => {
    await initI18n('ar');
  });

  it('renders a cases invoice from the snapshot: lab identity, grouped lines, totals and balances in Arabic, RTL', () => {
    render(<InvoiceDocument snapshot={casesSnapshot()} logoUrl={null} />);
    expect(doc()).toHaveAttribute('lang', 'ar');
    expect(doc()).toHaveAttribute('dir', 'rtl');
    // The page keeps its one h1; the document's title is a level-2 heading.
    expect(screen.getByRole('heading', { level: 2, name: 'فاتورة' })).toBeInTheDocument();
    expect(doc().querySelector('h1')).toBeNull();
    expect(doc().querySelector('.inv-lab-name')).toHaveTextContent('مختبر الاختبار');
    expect(doc().querySelector('[data-invoice-no]')).toHaveTextContent('1001');
    const rows = within(doc().querySelector('[data-invoice-lines]') as HTMLElement).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 grouped lines
    expect(rows[1]).toHaveTextContent('11 · 21');
    expect(rows[2]).toHaveTextContent('الفك العلوي');
    const totals = doc().querySelector('[data-invoice-totals]') as HTMLElement;
    expect(totals).toHaveTextContent('50,000.00 ₪'.replace('50,000.00', '500.00'));
    expect(doc().querySelector('[data-invoice-total]')).toHaveTextContent('480.00 ₪');
    // A negative previous balance is written as an amount plus words, never a bare minus.
    expect(totals).toHaveTextContent('180.00 ₪ (رصيد للطبيب)');
    expect(totals.textContent).not.toContain('-180');
    expect(doc().querySelector('[data-invoice-notes]')).toHaveTextContent('شكرًا');
  });

  it('a reprint in English changes the labels and the direction only, never the content', () => {
    render(<InvoiceDocument snapshot={casesSnapshot()} logoUrl={null} language="en" />);
    expect(doc()).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { name: 'Invoice' })).toBeInTheDocument();
    // The English lab name is printed in English; user data stays as typed.
    expect(doc().querySelector('.inv-lab-name')).toHaveTextContent('Test Lab');
    expect(within(doc()).getAllByText('ليلى حداد').length).toBeGreaterThan(0);
    expect(doc().querySelector('[data-invoice-total]')).toHaveTextContent('480.00 ₪');
  });

  it('honours the frozen layout: hidden columns, widths, no balances', () => {
    const s = casesSnapshot({ layout: { columns: ['caseNo', 'lineTotal'], widths: { caseNo: 30 }, showLogo: true, showBalances: false, footerText: 'تذييل' } });
    render(<InvoiceDocument snapshot={s} logoUrl={null} />);
    const headers = [...doc().querySelectorAll('th')].map((th) => th.getAttribute('data-col'));
    expect(headers).toEqual(['caseNo', 'lineTotal']);
    expect(doc().querySelector('col')).toHaveAttribute('style', 'width: 30mm;');
    expect(doc().textContent).not.toContain('الرصيد السابق');
    expect(doc().querySelector('[data-invoice-notes]')).toHaveTextContent('تذييل');
  });

  it('statements and free invoices render their own body', () => {
    const { unmount } = render(<InvoiceDocument snapshot={statementSnapshot()} logoUrl={null} />);
    expect(screen.getByRole('heading', { name: 'كشف حساب' })).toBeInTheDocument();
    expect(doc().querySelector('[data-invoice-total]')).toHaveTextContent('100.00 ₪ (رصيد للطبيب)');
    expect(doc()).toHaveTextContent('للحالة 1024');
    unmount();
    render(<InvoiceDocument snapshot={freeSnapshot()} logoUrl={null} />);
    expect(doc()).toHaveTextContent('أجرة توصيل');
    expect(doc().querySelector('[data-invoice-total]')).toHaveTextContent('25.00 ₪');
  });

  it('SPEC §5.14: a document whose total does not match the program’s calculation is not shown', () => {
    const s = casesSnapshot();
    s.totals.total += 1;
    render(<InvoiceDocument snapshot={s} logoUrl={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('الإجمالي المعروض لا يطابق حساب البرنامج — راجع البنود.');
    expect(doc()).toBeNull();
  });

  it('shows the lab logo only when there is one and the layout wants it; otherwise the lab name alone', () => {
    const { unmount } = render(<InvoiceDocument snapshot={casesSnapshot()} logoUrl="blob:lab-logo" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:lab-logo');
    expect(img).toHaveAccessibleName('شعار مختبر الاختبار');
    unmount();
    render(<InvoiceDocument snapshot={casesSnapshot()} logoUrl={null} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('never shows the product’s name or logo (SPEC §2.3), in any type or language', () => {
    for (const s of [casesSnapshot(), statementSnapshot(), freeSnapshot()]) {
      for (const language of ['ar', 'en'] as const) {
        const { container, unmount } = render(<InvoiceDocument snapshot={s} logoUrl="blob:lab-logo" language={language} />);
        expect(container.textContent).not.toContain(PRODUCT_NAME);
        expect(container.textContent).not.toMatch(/بسمة|Basma|Smile Artec|Powered by/i);
        const images = [...container.querySelectorAll('img')];
        expect(images.every((i) => i.getAttribute('src') === 'blob:lab-logo' && i.hasAttribute('data-lab-logo'))).toBe(true);
        unmount();
      }
    }
  });

  it('the void band is printed with the reason', () => {
    render(<InvoiceDocument snapshot={casesSnapshot()} logoUrl={null} voided={{ reason: 'خطأ' }} />);
    expect(doc().querySelector('[data-void-band]')).toHaveTextContent('ملغاة — خطأ');
  });

  it('injection: script tags, event handlers, url() and javascript: anywhere in the data or the style never become markup', () => {
    const evil = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1"><a href="javascript:alert(1)">x</a>';
    const css = 'red;background:url(javascript:alert(1))}body{display:none';
    const s = casesSnapshot({
      lab: { nameAr: evil, nameEn: evil, phone: evil, address: evil, slogan: evil, logo: null },
      party: { kind: 'doctor', doctorId: 1, name: evil, clinic: evil, phone: evil },
      notes: evil,
      layout: { ...layoutOf(DEFAULT_INVOICE_TEMPLATE), footerText: evil },
    });
    s.lines = s.lines.map((l) => ({ ...l, patientName: evil, workTypeName: evil, shade: evil }));
    const style = { primaryColor: css, headerTextColor: 'url(x)', tableHeaderColor: 'expression(alert(1))', fontSize: css, margins: { top: css, end: 1e9, bottom: -3, start: 'x' } } as never;
    const { container } = render(<InvoiceDocument snapshot={s} style={style} logoUrl={null} />);
    expect(container.querySelectorAll('script')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) expect(attr.startsWith('on')).toBe(false);
      const inline = el.getAttribute('style') ?? '';
      expect(inline).not.toMatch(/url\(|javascript:|expression\(/i);
    }
    // The text is shown as text.
    expect(container.textContent).toContain('<script>window.__pwned=1</script>');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // Every style value fell back to a safe one; the @page rule holds numbers only.
    expect(safeStyle(style)).toEqual(safeStyle(undefined));
    const rule = container.querySelector('style')?.textContent ?? '';
    expect(rule).toBe(pageRule(safeStyle(undefined), 'rtl'));
    expect(rule).toMatch(/^@page \{ size: A4; margin: \d+mm \d+mm \d+mm \d+mm;/);
  });

  it('the @page rule maps start/end to the sides of the document direction', () => {
    const s = safeStyle({ margins: { top: 10, end: 20, bottom: 15, start: 5 } });
    expect(pageRule(s, 'rtl')).toContain('margin: 10mm 5mm 15mm 20mm;');
    expect(pageRule(s, 'ltr')).toContain('margin: 10mm 20mm 15mm 5mm;');
  });

  it('lint guard: the printing renderer never imports the product logo or name', () => {
    const dir = path.resolve(__dirname, 'document');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      expect({ f, product: /PRODUCT_NAME|product-logo|basma-logo|assets\/brand/.test(text) }).toEqual({ f, product: false });
    }
  });
});

// ---------------------------------------------------------------- screens

const invoiceResponse = (over: Record<string, unknown> = {}) => ({
  id: 5,
  no: 1001,
  type: 'cases',
  status: 'active',
  issueDate: '2026-11-20',
  language: 'ar',
  currencyCode: 'ILS',
  doctorId: 7,
  partyName: 'د. أحمد سالم',
  subtotal: 50000,
  discount: 2000,
  total: 48000,
  voidReason: null,
  voidedAt: null,
  rowVersion: 1,
  createdAt: '2026-11-20T10:00:00Z',
  snapshotVersion: 1,
  snapshotSha256: 'a'.repeat(64),
  snapshot: casesSnapshot(),
  ...over,
});

function setup() {
  resetSessionForTests();
  session.set({ accessToken: 't' });
}

describe('screens', () => {
  beforeEach(async () => {
    setup();
    await initI18n('ar');
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('new cases invoice: pick a doctor and cases, the server preview is shown, issuing sends the previewed total once with an Idempotency-Key', async () => {
    const posts: { body: Record<string, unknown>; key: string | null }[] = [];
    let previews = 0;
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': me(ALL),
      'GET /api/v1/settings/invoice-template': () => json(200, { template: DEFAULT_INVOICE_TEMPLATE, rowVersion: 0 }),
      'GET /api/v1/doctors/7': () => json(200, { id: 7, name: 'د. أحمد سالم', active: true, rowVersion: 1 }),
      'GET /api/v1/invoices/eligible-cases': () =>
        json(200, {
          page: 1,
          pageSize: 100,
          total: 2,
          doctor: { id: 7, name: 'د. أحمد سالم' },
          items: [
            { caseId: 41, caseNo: 1024, patientName: 'ليلى حداد', receivedDate: '2026-11-01', deliveredDate: '2026-11-10', status: 'delivered', total: 30000, paid: 0, remaining: 30000 },
            { caseId: 42, caseNo: 1031, patientName: 'محمود ناصر', receivedDate: '2026-11-02', deliveredDate: null, status: 'ready', total: 18000, paid: 0, remaining: 18000 },
          ],
        }),
      'POST /api/v1/invoices/preview': () => {
        previews += 1;
        return json(200, { snapshot: { ...casesSnapshot(), no: 0 } });
      },
      'POST /api/v1/invoices': async (req) => {
        posts.push({ body: (await req.json()) as Record<string, unknown>, key: req.headers.get('Idempotency-Key') });
        return posts.length === 1
          ? json(409, envelope('error.invoice.total_changed', 'تغيّر إجمالي الحالات منذ المعاينة. راجع المعاينة ثم أعد المحاولة.'))
          : json(201, invoiceResponse());
      },
    });
    const { router } = renderRoutes(
      [
        { path: '/invoices/new', element: <NewInvoicePage /> },
        { path: '/invoices/:id', element: <p>invoice page</p> },
      ],
      '/invoices/new?type=cases&doctor=7',
    );
    const all = await screen.findByRole('checkbox', { name: 'تحديد كل الحالات' });
    await userEvent.click(all);
    await waitFor(() => expect(previews).toBeGreaterThan(0));
    expect(await screen.findByRole('region', { name: 'المعاينة' })).toBeInTheDocument();
    const issue = screen.getByRole('button', { name: 'إنشاء وطباعة' });
    await waitFor(() => expect(issue).toBeEnabled());
    await userEvent.click(issue);
    // The server's answer is shown in the form; the retry sends the same request with the same key.
    expect(await screen.findByRole('alert')).toHaveTextContent('تغيّر إجمالي الحالات منذ المعاينة');
    await waitFor(() => expect(screen.getByRole('button', { name: 'إنشاء وطباعة' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء وطباعة' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/invoices/5'));
    expect(router.state.location.search).toBe('?print=1');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.body).toEqual({ type: 'cases', doctorId: 7, caseIds: [41, 42], language: 'ar', expectedTotal: 48000 });
    expect(posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1]!.key).toBe(posts[0]!.key);
  });

  it('new cases invoice: «لا توجد حالات بانتظار الفوترة.» when the doctor has none', async () => {
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': me(ALL),
      'GET /api/v1/doctors/7': () => json(200, { id: 7, name: 'د. أحمد سالم', active: true, rowVersion: 1 }),
      'GET /api/v1/invoices/eligible-cases': () => json(200, { page: 1, pageSize: 100, total: 0, doctor: { id: 7, name: 'د' }, items: [] }),
    });
    renderRoutes([{ path: '/invoices/new', element: <NewInvoicePage /> }], '/invoices/new?doctor=7');
    expect(await screen.findByText('لا توجد حالات بانتظار الفوترة.')).toBeInTheDocument();
  });

  it('free invoice: reason and a positive amount are required, inline in Arabic', async () => {
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': me(ALL),
    });
    renderRoutes([{ path: '/invoices/new', element: <NewInvoicePage /> }], '/invoices/new?type=free');
    await userEvent.click(await screen.findByRole('radio', { name: 'اسم آخر' }));
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء وطباعة' }));
    expect(screen.getByRole('textbox', { name: /^اسم الجهة/ })).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    expect(screen.getByRole('textbox', { name: /^السبب/ })).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    await userEvent.type(screen.getByRole('textbox', { name: /^المبلغ/ }), '0');
    expect(screen.getByRole('textbox', { name: /^المبلغ/ })).toHaveAccessibleDescription('اكتب مبلغًا أكبر من صفر.');
  });

  const mountInvoice = (over: Record<string, unknown> = {}, extra: Record<string, (req: Request) => Response | Promise<Response>> = {}) => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': me(ALL),
      'GET /api/v1/settings/invoice-template': () => json(200, { template: { ...DEFAULT_INVOICE_TEMPLATE, primaryColor: '#123456' }, rowVersion: 2 }),
      'GET /api/v1/invoices/5': () => json(200, invoiceResponse(over)),
      ...extra,
    });
    const view = renderRoutes(
      [
        {
          path: '/invoices/:id',
          element: (
            <Suspense fallback={null}>
              <InvoicePage />
            </Suspense>
          ),
        },
      ],
      '/invoices/5',
    );
    return { calls, view };
  };

  it('the invoice page prints the frozen snapshot with the current colours; print waits for fonts', async () => {
    mountInvoice();
    expect(await screen.findByRole('heading', { level: 1, name: 'فاتورة حالات رقم 1001' })).toBeInTheDocument();
    await waitFor(() => expect(doc()).toHaveStyle({ '--inv-primary': '#123456' }));
    await userEvent.click(screen.getByRole('button', { name: 'طباعة' }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    // Reprint in English: labels change, figures do not.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'لغة الطباعة' }), 'en');
    expect(doc()).toHaveAttribute('lang', 'en');
    expect(doc().querySelector('[data-invoice-total]')).toHaveTextContent('480.00 ₪');
  });

  it('void: a reason is required; the request carries the rowVersion; a void invoice cannot be voided again', async () => {
    const bodies: unknown[] = [];
    mountInvoice({}, {
      'POST /api/v1/invoices/5/void': async (req) => {
        bodies.push(await req.json());
        return json(200, invoiceResponse({ status: 'void', voidReason: 'خطأ', rowVersion: 2 }));
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'إلغاء الفاتورة' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء الفاتورة' }));
    expect(within(dialog).getByRole('textbox', { name: /^سبب الإلغاء/ })).toHaveAccessibleDescription('هذا الحقل مطلوب.');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^سبب الإلغاء/ }), 'خطأ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'إلغاء الفاتورة' }));
    await waitFor(() => expect(bodies).toEqual([{ rowVersion: 1, reason: 'خطأ' }]));
  });

  it('a void invoice shows the band and its void button explains why it is disabled', async () => {
    mountInvoice({ status: 'void', voidReason: 'خطأ في الخصم' });
    const button = await screen.findByRole('button', { name: 'إلغاء الفاتورة' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('الفاتورة ملغاة بالفعل.');
    expect(doc().querySelector('[data-void-band]')).toHaveTextContent('خطأ في الخصم');
  });

  it('appearance: invalid colours are refused inline and never reach the preview; footer text is shown as text; save sends the validated template', async () => {
    const saved: unknown[] = [];
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/auth/me': me(ALL),
      'GET /api/v1/settings/invoice-template': () => json(200, { template: DEFAULT_INVOICE_TEMPLATE, rowVersion: 0 }),
      'PUT /api/v1/settings/invoice-template': async (req) => {
        const b = (await req.json()) as { template: unknown };
        saved.push(b);
        return json(200, { template: b.template, rowVersion: 1 });
      },
    });
    renderRoutes([
      {
        path: '/',
        element: (
          <Suspense fallback={null}>
            <InvoiceAppearancePage />
          </Suspense>
        ),
      },
    ]);
    const colour = await screen.findByRole('textbox', { name: /^اللون الرئيسي/ });
    await waitFor(() => expect(colour).toBeEnabled()); // editable once the permissions are known
    await userEvent.clear(colour);
    await userEvent.type(colour, 'url(javascript:x)');
    expect(colour).toHaveAccessibleDescription('اكتب لونًا مثل ‎#006EBD.');
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeDisabled();
    expect(doc()).toHaveStyle({ '--inv-primary': '#006EBD' });
    await userEvent.clear(colour);
    await userEvent.type(colour, '#00aa55');
    await userEvent.type(screen.getByRole('textbox', { name: /^نص التذييل/ }), '<img src=x onerror="alert(1)">');
    await waitFor(() => expect(doc().querySelector('[data-invoice-notes]')).toHaveTextContent('<img src=x onerror="alert(1)">'));
    expect(doc().querySelectorAll('img')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ rowVersion: 0, template: { primaryColor: '#00AA55', footerText: '<img src=x onerror="alert(1)">' } });
  });
});
