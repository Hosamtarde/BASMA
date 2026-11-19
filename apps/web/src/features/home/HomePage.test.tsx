import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import type { CaseCounts, CaseSummary } from '@/features/cases/api';
import { initI18n } from '@/i18n/i18n';
import { ledgerSummaryFixture, settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import { HomePage } from './HomePage';

const counts = (byStatus: Partial<CaseCounts['byStatus']> = {}, overdue = 0): CaseCounts => {
  const all = {
    waiting: 0,
    design: 0,
    in_progress: 0,
    ready: 0,
    delivered: 0,
    returned: 0,
    cancelled: 0,
    ...byStatus,
  };
  return { byStatus: all, total: Object.values(all).reduce((a, b) => a + b, 0), overdue };
};

const summary = (over: Partial<CaseSummary> = {}): CaseSummary => ({
  id: 41,
  caseNo: 1288,
  doctor: { id: 7, name: 'د. أحمد سالم' },
  patientName: 'ليلى حداد',
  technician: null,
  receivedDate: '2026-11-01',
  expectedDate: '2026-11-05',
  deliveredDate: null,
  status: 'design',
  total: 47000,
  paid: 0,
  remaining: 47000,
  overdue: false,
  rowVersion: 4,
  ...over,
});

const page = (items: object[], total = items.length) => ({ page: 1, pageSize: 25, total, items });

function render(c: CaseCounts, latest: CaseSummary[] = [], settings = settingsFixture()) {
  const calls = stubApi({
    'GET /api/v1/settings': () => json(200, settings),
    'GET /api/v1/cases/summary': () => json(200, c),
    'GET /api/v1/cases': () => json(200, page(latest)),
    'GET /api/v1/doctors': () => json(200, page([], 4)),
    'GET /api/v1/ledger/summary': () => json(200, ledgerSummaryFixture()),
  });
  const view = renderRoutes(
    [
      {
        path: '/',
        element: (
          <Suspense fallback={null}>
            <HomePage />
          </Suspense>
        ),
      },
      { path: '/cases/*', element: <p>cases screen</p> },
    ],
    '/',
  );
  return { ...view, calls };
}

describe('HomePage', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the lab name as the page heading and a friendly empty state with a first-case button', async () => {
    render(counts());
    expect(await screen.findByRole('heading', { level: 1, name: 'مختبر الاختبار' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'لا توجد حالات بعد' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'أضف أول حالة' })).toHaveAttribute('href', '/cases/new');
    // No pipeline without cases; the three bottom panels stay, with zeros and an empty ring.
    expect(screen.queryByRole('heading', { name: 'مسار الحالات' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'توزيع الحالات حسب المرحلة، المجموع 0' })).toBeInTheDocument();
    expect(document.querySelectorAll('circle[data-status]')).toHaveLength(0);
    const keyNumbers = screen.getByRole('heading', { name: 'الأرقام الرئيسية' }).closest('section')!;
    expect(within(keyNumbers).getByRole('link', { name: 'الحالات 0' })).toHaveAttribute('href', '/cases');
    const latest = screen.getByRole('heading', { name: 'آخر الحالات' }).closest('section')!;
    expect(await within(latest).findByText('ستظهر هنا الحالات التي تسجّلها.')).toBeInTheDocument();
  });

  it('banner: the other-language name as a letter-spaced Latin line, a brand mark without a logo, no product name', async () => {
    render(counts());
    const banner = (await screen.findByRole('heading', { level: 1 })).closest('section')!;
    const subtitle = banner.querySelector('[data-banner-subtitle]')!;
    expect(subtitle).toHaveTextContent('Test Lab');
    expect(subtitle).toHaveAttribute('lang', 'en');
    expect(subtitle).toHaveClass('uppercase');
    expect(banner.querySelector('[data-banner-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(banner).queryByRole('img')).not.toBeInTheDocument();
    expect(banner).not.toHaveTextContent('بسمة');
    expect(banner).not.toHaveTextContent('Basma');
    expect(banner.querySelector('[data-product-logo]')).toBeNull();
    expect(banner).toHaveTextContent(/\d{4}-\d{2}-\d{2}/);
  });

  it('banner: the slogan replaces the second line; an Arabic slogan is never letter-spaced', async () => {
    const s = settingsFixture();
    render(counts(), [], { ...s, labProfile: { ...s.labProfile!, slogan: 'الدقة في كل سن' } });
    const banner = (await screen.findByRole('heading', { level: 1 })).closest('section')!;
    const subtitle = banner.querySelector('[data-banner-subtitle]')!;
    expect(subtitle).toHaveTextContent('الدقة في كل سن');
    expect(subtitle).toHaveAttribute('lang', 'ar');
    expect(subtitle).not.toHaveClass('uppercase');
    expect(banner).not.toHaveTextContent('Test Lab');
  });

  it('key numbers: only real figures (cases, doctors and the ledger), each opening its list', async () => {
    render(counts({ design: 3, ready: 2, delivered: 4 }, 1), [summary()]);
    const panel = (await screen.findByRole('heading', { name: 'الأرقام الرئيسية' })).closest('section')!;
    await waitFor(() =>
      expect(within(panel).getByRole('link', { name: 'الأطباء النشطون 4' })).toHaveAttribute(
        'href',
        '/doctors',
      ),
    );
    expect(within(panel).getByRole('link', { name: 'الحالات 9' })).toHaveAttribute('href', '/cases');
    expect(within(panel).getByRole('link', { name: 'جاهزة للتسليم 2' })).toHaveAttribute(
      'href',
      '/cases?status=ready',
    );
    expect(within(panel).getByRole('link', { name: 'حالات متأخرة 1' })).toHaveAttribute(
      'href',
      '/cases?overdue=1',
    );
    // The ledger figures (B3): received this month, owed to the lab, cheques pending.
    expect(within(panel).getByRole('link', { name: /^المقبوض هذا الشهر/ })).toHaveAttribute('href', '/payments');
    await waitFor(() =>
      expect(within(panel).getByRole('link', { name: /^المقبوض هذا الشهر/ })).toHaveTextContent('1,250.00 ₪'),
    );
    expect(within(panel).getByRole('link', { name: /^المستحق للمختبر/ })).toHaveAttribute('href', '/debts');
    expect(within(panel).getByRole('link', { name: /^شيكات قيد التحصيل/ })).toHaveAttribute(
      'href',
      '/cheques?status=pending',
    );
    // B4b: expenses this month joined the key numbers (a user without expenses.read does not see it).
    expect(within(panel).getByRole('link', { name: /^المصاريف هذا الشهر/ })).toHaveAttribute('href', '/outgoing');
    expect(within(panel).getByRole('link', { name: /^المصاريف هذا الشهر/ })).toHaveTextContent('400.00 ₪');
    expect(within(panel).getAllByRole('link')).toHaveLength(8);
    expect(panel).not.toHaveTextContent(/الفواتير/);
  });

  it('without expenses.read the API sends null: no expenses key number, no figure on the outgoing card, cheques count the doctors’ only', async () => {
    const calls = stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      'GET /api/v1/cases/summary': () => json(200, counts({ ready: 1 })),
      'GET /api/v1/cases': () => json(200, page([])),
      'GET /api/v1/doctors': () => json(200, page([], 4)),
      'GET /api/v1/ledger/summary': () =>
        json(200, ledgerSummaryFixture({ outgoingThisMonth: null, outgoingTotal: null, outgoingChequesDueSoon: null, outgoingChequesOverdue: null })),
    });
    renderRoutes(
      [
        { path: '/', element: <Suspense fallback={null}><HomePage /></Suspense> },
        { path: '*', element: <p>elsewhere</p> },
      ],
      '/',
    );
    const cards = (await screen.findByRole('heading', { name: 'ماذا تريد أن تسجّل؟' })).closest('section')!;
    await waitFor(() => expect(within(cards).getByRole('link', { name: /^الديون/ })).toHaveTextContent('4,500.00 ₪'));
    expect(within(cards).getByRole('link', { name: /^دفعة صادرة/ })).not.toHaveTextContent('₪');
    expect(within(cards).getByRole('link', { name: /^سجل الشيكات/ })).toHaveTextContent('2 شيكات تستحق قريبًا');
    const panel = screen.getByRole('heading', { name: 'الأرقام الرئيسية' }).closest('section')!;
    expect(within(panel).queryByRole('link', { name: /^المصاريف هذا الشهر/ })).toBeNull();
    expect(within(panel).getAllByRole('link')).toHaveLength(7);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('pipeline: a live count per stage and overdue, each linking to the filtered case list', async () => {
    render(counts({ waiting: 2, design: 3, ready: 1, delivered: 5, returned: 1, cancelled: 1 }, 2), [
      summary(),
    ]);
    const pipeline = (await screen.findByRole('heading', { name: 'مسار الحالات' })).closest('section')!;
    const link = (name: RegExp) => within(pipeline).getByRole('link', { name });
    expect(link(/^قيد التصميم 3$/)).toHaveAttribute('href', '/cases?status=design');
    expect(link(/^بالانتظار 2$/)).toHaveAttribute('href', '/cases?status=waiting');
    expect(link(/^تم التسليم 5$/)).toHaveAttribute('href', '/cases?status=delivered');
    expect(link(/^مرتجعة للتعديل 1$/)).toHaveAttribute('href', '/cases?status=returned');
    expect(link(/^ملغاة 1$/)).toHaveAttribute('href', '/cases?status=cancelled');
    expect(link(/^متأخرة 2$/)).toHaveAttribute('href', '/cases?overdue=1');
    expect(link(/^كل الحالات \(13\)$/)).toHaveAttribute('href', '/cases');
  });

  it('donut: an image with a summary name, and a legend with every status and its count', async () => {
    render(counts({ design: 3, delivered: 5 }), [summary()]);
    expect(
      await screen.findByRole('img', { name: 'توزيع الحالات حسب المرحلة، المجموع 8' }),
    ).toBeInTheDocument();
    const legend = screen.getByRole('heading', { name: 'بيان عام على جميع الحالات' }).closest('section')!;
    expect(within(legend).getAllByRole('link')).toHaveLength(7);
    expect(within(legend).getByRole('link', { name: 'تم التسليم 5' })).toHaveAttribute(
      'href',
      '/cases?status=delivered',
    );
    expect(within(legend).getByRole('link', { name: 'جاهزة للتسليم 0' })).toBeInTheDocument();
    // A thin ring (14 of 136), one arc per non-empty status, the centre left empty.
    const arcs = legend.querySelectorAll('circle[data-status]');
    expect([...arcs].map((a) => a.getAttribute('data-status'))).toEqual(['design', 'delivered']);
    expect(arcs[0]).toHaveAttribute('stroke-width', '14');
    expect(legend.querySelector('svg text')).toBeNull();
  });

  it('action cards: built ones are links with live figures; invoice is unavailable, not focusable', async () => {
    render(counts({ ready: 7 }), [summary()]);
    const cards = (await screen.findByRole('heading', { name: 'ماذا تريد أن تسجّل؟' })).closest('section')!;
    const add = within(cards).getByRole('link', { name: /^إضافة حالة جديدة/ });
    expect(add).toHaveAttribute('href', '/cases/new');
    await waitFor(() => expect(add).toHaveTextContent('7 جاهزة للتسليم'));
    expect(within(cards).getByRole('link', { name: /^الأطباء/ })).toHaveAttribute('href', '/doctors');
    // B3: incoming payments, debts and cheques are built, with live figures.
    const incoming = within(cards).getByRole('link', { name: /^دفعة واردة/ });
    expect(incoming).toHaveAttribute('href', '/payments');
    await waitFor(() => expect(incoming).toHaveTextContent('1,250.00 ₪ مقبوضة هذا الشهر'));
    const debts = within(cards).getByRole('link', { name: /^الديون/ });
    expect(debts).toHaveAttribute('href', '/debts');
    expect(debts).toHaveTextContent('4,500.00 ₪ مستحقة للمختبر');
    const cheques = within(cards).getByRole('link', { name: /^سجل الشيكات/ });
    expect(cheques).toHaveAttribute('href', '/cheques');
    // Both directions: 1 + 1 incoming, 1 outgoing due soon (X11).
    expect(cheques).toHaveTextContent('3 شيكات تستحق قريبًا');
    // B4b: the outgoing card is a link with this month's expenses.
    const outgoing = within(cards).getByRole('link', { name: /^دفعة صادرة/ });
    expect(outgoing).toHaveAttribute('href', '/outgoing');
    await waitFor(() => expect(outgoing).toHaveTextContent('400.00 ₪ مصاريف هذا الشهر'));
    for (const name of ['إنشاء فاتورة']) {
      const card = within(cards).getByRole('link', { name: new RegExp(`^${name}`) });
      expect(card).toHaveAttribute('aria-disabled', 'true');
      expect(card).not.toHaveAttribute('href');
      expect(card).not.toHaveAttribute('tabindex');
      expect(card).toHaveTextContent('قريباً في تحديث قادم');
      // Same language as the built cards: brand knob (softer) and the figure band.
      expect(card.querySelector('.knob-soon')).not.toBeNull();
      expect(card.querySelector('[class*="bg-band-"]')).not.toBeNull();
    }
  });

  it('latest cases: each opens its details by the number, the «فتح» button or the row', async () => {
    render(counts({ design: 1 }), [
      summary(),
      summary({ id: 42, caseNo: 1289, status: 'ready', patientName: 'رنا يوسف' }),
    ]);
    const latest = (await screen.findByRole('heading', { name: 'آخر الحالات' })).closest('section')!;
    expect(within(latest).getByRole('link', { name: '1288' })).toHaveAttribute('href', '/cases/41');
    expect(within(latest).getByRole('link', { name: 'فتح الحالة 1289' })).toHaveAttribute(
      'href',
      '/cases/42',
    );
    await userEvent.click(within(latest).getByText('ليلى حداد', { selector: 'span' }).closest('li')!);
    expect(await screen.findByText('cases screen')).toBeInTheDocument();
  });
});
