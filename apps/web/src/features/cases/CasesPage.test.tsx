import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import type { CaseCounts, CaseDetail, CaseSummary } from './api';
import { CasesPage } from './CasesPage';

const row = (over: Partial<CaseSummary> = {}): CaseSummary => ({
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
const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  ...row(),
  subtotal: 47000,
  discount: 0,
  notes: null,
  lines: [],
  history: [],
  allowedStatuses: ['waiting', 'in_progress', 'ready', 'delivered'],
  canCancel: true,
  canEdit: true,
  ...over,
});
const counts: CaseCounts = {
  byStatus: { waiting: 2, design: 3, in_progress: 0, ready: 1, delivered: 5, returned: 0, cancelled: 1 },
  total: 12,
  overdue: 2,
};

function Opened() {
  return <p>opened {useLocation().pathname}</p>;
}

function render(cases: CaseSummary[], details: Record<number, CaseDetail> = {}) {
  const calls = stubApi({
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/cases': () => json(200, { page: 1, pageSize: 25, total: cases.length, items: cases }),
    'GET /api/v1/cases/summary': () => json(200, counts),
    ...Object.fromEntries(
      Object.entries(details).map(([id, d]) => [`GET /api/v1/cases/${id}`, () => json(200, d)]),
    ),
    'POST /api/v1/cases/41/status': () => json(200, detail({ status: 'ready', rowVersion: 5 })),
    'POST /api/v1/cases/41/cancel': () => json(200, detail({ status: 'cancelled', rowVersion: 5 })),
  });
  renderRoutes(
    [
      { path: '/cases', element: <CasesPage /> },
      { path: '/cases/:id', element: <Opened /> },
    ],
    '/cases',
  );
  return calls;
}

describe('CasesPage: opening and acting on a case from the list', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('status chips count from GET /cases/summary', async () => {
    render([row()]);
    const chips = await screen.findByRole('group', { name: 'تصفية حسب الحالة' });
    await waitFor(() => expect(within(chips).getByRole('button', { name: 'الكل 12' })).toBeInTheDocument());
    expect(within(chips).getByRole('button', { name: 'قيد التصميم 3' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'ملغاة 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^المتأخرة فقط/ })).toBeInTheDocument();
  });

  it('every row has a labelled «عرض / تعديل» link and the case number is a link', async () => {
    render([row(), row({ id: 42, caseNo: 1289, patientName: 'رنا يوسف' })]);
    const view = await screen.findByRole('link', { name: 'عرض / تعديل الحالة 1289' });
    expect(view).toHaveAttribute('href', '/cases/42');
    expect(view).toHaveTextContent('عرض / تعديل');
    expect(screen.getByRole('link', { name: '1288' })).toHaveAttribute('href', '/cases/41');
    await userEvent.click(view);
    expect(await screen.findByText('opened /cases/42')).toBeInTheDocument();
  });

  it('a click anywhere on the row opens the case', async () => {
    render([row()]);
    await userEvent.click(await screen.findByText('ليلى حداد'));
    expect(await screen.findByText('opened /cases/41')).toBeInTheDocument();
  });

  it('the «⋮» menu lists only what the API allows, and opens the same status dialog', async () => {
    const calls = render([row()], { 41: detail() });
    await userEvent.click(await screen.findByRole('button', { name: 'إجراءات أخرى للحالة 1288' }));
    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByRole('menuitem', { name: 'تغيير المرحلة' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'إلغاء الحالة' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'فتح الحالة' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'تغيير المرحلة' }));
    const dialog = await screen.findByRole('dialog', { name: 'تغيير مرحلة الحالة' });
    // The menu item did not also open the row.
    expect(screen.queryByText(/^opened/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'جاهزة للتسليم' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.parse(calls.find((c) => c.key === 'POST /api/v1/cases/41/status')?.body ?? '{}')).toEqual({
      rowVersion: 4,
      to: 'ready',
      note: null,
    });
    expect(screen.queryByText(/^opened/)).not.toBeInTheDocument();
  });

  it('a delivered case offers no cancel; a cancelled one offers only «فتح الحالة»', async () => {
    render(
      [row({ status: 'delivered' }), row({ id: 43, caseNo: 1290, status: 'cancelled', patientName: 'كريم' })],
      {
        41: detail({ status: 'delivered', allowedStatuses: ['returned'], canCancel: false }),
        43: detail({
          id: 43,
          caseNo: 1290,
          status: 'cancelled',
          allowedStatuses: [],
          canCancel: false,
          canEdit: false,
        }),
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'إجراءات أخرى للحالة 1288' }));
    let menu = await screen.findByRole('menu');
    expect(await within(menu).findByRole('menuitem', { name: 'تغيير المرحلة' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'إلغاء الحالة' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'إجراءات أخرى للحالة 1290' }));
    menu = await screen.findByRole('menu');
    expect(await within(menu).findByRole('menuitem', { name: 'لا إجراءات أخرى متاحة' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menu).queryByRole('menuitem', { name: 'تغيير المرحلة' })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'فتح الحالة' }));
    expect(await screen.findByText('opened /cases/43')).toBeInTheDocument();
  });
});
