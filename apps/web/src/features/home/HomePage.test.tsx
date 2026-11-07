import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import type { CaseCounts, CaseSummary } from '@/features/cases/api';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
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
  overdue: false,
  rowVersion: 4,
  ...over,
});

const page = (items: object[], total = items.length) => ({ page: 1, pageSize: 25, total, items });

function render(c: CaseCounts, latest: CaseSummary[] = []) {
  const calls = stubApi({
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/cases/summary': () => json(200, c),
    'GET /api/v1/cases': () => json(200, page(latest)),
    'GET /api/v1/doctors': () => json(200, page([], 4)),
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
    // No pipeline, donut or latest list without cases.
    expect(screen.queryByRole('heading', { name: 'مسار الحالات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /توزيع الحالات/ })).not.toBeInTheDocument();
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
  });

  it('action cards: built ones are links with live figures; the others are unavailable, not focusable', async () => {
    render(counts({ ready: 7 }), [summary()]);
    const cards = (await screen.findByRole('heading', { name: 'ماذا تريد أن تسجّل؟' })).closest('section')!;
    const add = within(cards).getByRole('link', { name: /^إضافة حالة جديدة/ });
    expect(add).toHaveAttribute('href', '/cases/new');
    await waitFor(() => expect(add).toHaveTextContent('7 جاهزة للتسليم'));
    expect(within(cards).getByRole('link', { name: /^الأطباء/ })).toHaveAttribute('href', '/doctors');
    for (const name of ['دفعة واردة', 'دفعة صادرة', 'الديون', 'سجل الشيكات', 'إنشاء فاتورة']) {
      const card = within(cards).getByRole('link', { name: new RegExp(`^${name}`) });
      expect(card).toHaveAttribute('aria-disabled', 'true');
      expect(card).not.toHaveAttribute('href');
      expect(card).not.toHaveAttribute('tabindex');
      expect(card).toHaveTextContent('قريباً');
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
