import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { changeLanguage, initI18n } from '@/i18n/i18n';
import { ledgerSummaryFixture, settingsFixture } from '@/test/fixtures';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { HomePage } from './HomePage';

const ITEMS = [
  {
    at: '2026-11-20T10:30:00.000Z',
    action: 'payment.created',
    entityType: 'payment',
    entityLabel: 'IN-000031',
    actor: 'owner',
  },
  {
    at: '2026-11-20T09:00:00.000Z',
    action: 'case.created',
    entityType: 'case',
    entityLabel: '1288',
    actor: 'owner',
  },
  {
    at: '2026-11-19T08:00:00.000Z',
    action: 'doctor.created',
    entityType: 'doctor',
    entityLabel: 'د. أحمد سالم',
    actor: null,
  },
  {
    at: '2026-11-19T07:00:00.000Z',
    action: 'brand_new.action',
    entityType: '',
    entityLabel: null,
    actor: 'owner',
  },
];
const counts = {
  byStatus: { waiting: 0, design: 1, in_progress: 0, ready: 0, delivered: 0, returned: 0, cancelled: 0 },
  total: 1,
  overdue: 0,
};
const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });

function mount(permissions: string[], activity: () => Response | Promise<Response>) {
  const calls = stubApi({
    'GET /api/v1/auth/me': me(permissions),
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/cases/summary': () => json(200, counts),
    'GET /api/v1/cases': () => json(200, { page: 1, pageSize: 5, total: 0, items: [] }),
    'GET /api/v1/doctors': () => json(200, { page: 1, pageSize: 25, total: 0, items: [] }),
    'GET /api/v1/ledger/summary': () => json(200, ledgerSummaryFixture()),
    'GET /api/v1/audit/recent': activity,
  });
  renderRoutes(
    [
      {
        path: '/',
        element: (
          <Suspense fallback={null}>
            <HomePage />
          </Suspense>
        ),
      },
    ],
    '/',
  );
  return calls;
}

describe('Home «آخر العمليات»', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the entries with a label per action, the entity, the actor and the lab-time stamp', async () => {
    mount(['settings.read'], () => json(200, { items: ITEMS }));
    const panel = (await screen.findByRole('heading', { name: 'آخر العمليات' })).closest('section')!;
    const rows = await within(panel).findAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('تسجيل دفعة واردة IN-000031');
    expect(rows[0]).toHaveTextContent('بواسطة owner');
    expect(rows[0]).toHaveTextContent(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(rows[1]).toHaveTextContent('إنشاء حالة 1288');
    expect(rows[2]).toHaveTextContent('إضافة طبيب د. أحمد سالم');
    expect(rows[2]).toHaveTextContent('بواسطة النظام');
    // An action this version has no text for is still shown, never dropped or shown as a raw code.
    expect(rows[3]).toHaveTextContent('عملية');
    expect(rows[3]).not.toHaveTextContent('brand_new');
  });

  it('shows the same entries in English', async () => {
    await changeLanguage('en');
    mount(['settings.read'], () => json(200, { items: ITEMS }));
    const panel = (await screen.findByRole('heading', { name: 'Latest operations' })).closest('section')!;
    const rows = await within(panel).findAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Incoming payment recorded IN-000031');
    expect(rows[0]).toHaveTextContent('by owner');
    expect(rows[2]).toHaveTextContent('by System');
  });

  it('is not shown, and not requested, without settings.read', async () => {
    const calls = mount(['cases.read'], () => json(200, { items: ITEMS }));
    await screen.findByRole('heading', { name: 'الأرقام الرئيسية' });
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/v1/auth/me')).toBe(true));
    expect(screen.queryByRole('heading', { name: 'آخر العمليات' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === 'GET /api/v1/audit/recent')).toBe(false);
  });

  it('empty state', async () => {
    mount(['settings.read'], () => json(200, { items: [] }));
    expect(await screen.findByText('ستظهر هنا آخر العمليات التي تُجرى في النظام.')).toBeInTheDocument();
  });

  it('error state with a retry that loads the list', async () => {
    let fail = true;
    mount(['settings.read'], () =>
      fail ? json(500, envelope('error.internal', 'x')) : json(200, { items: ITEMS }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('تعذّر تحميل آخر العمليات.');
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('إنشاء حالة', { exact: false })).toBeInTheDocument();
  });

  it('loading state announces itself', async () => {
    mount(['settings.read'], () => new Promise<Response>(() => {}));
    const panel = (await screen.findByRole('heading', { name: 'آخر العمليات' })).closest('section')!;
    expect(within(panel).getByRole('status')).toHaveTextContent('جارٍ التحميل…');
  });
});
