import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import type { NotificationFeed } from './api';
import { NotificationBell } from './NotificationBell';

const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });

const feed = (over: Partial<NotificationFeed> = {}): NotificationFeed => ({
  today: '2026-11-10',
  unread: 2,
  total: 3,
  groups: [
    {
      type: 'case_due',
      total: 2,
      unread: 1,
      items: [
        {
          key: 'case_due:41:overdue:2026-11-08',
          type: 'case_due',
          phase: 'overdue',
          date: '2026-11-08',
          entity: { kind: 'case', id: 41 },
          params: { caseNo: 1288 },
          text: 'الحالة رقم 1288 للطبيب «د. أحمد سالم» متأخرة: كان موعدها 2026-11-08.',
          seen: false,
        },
      ],
    },
    {
      type: 'cheque_in_due',
      total: 1,
      unread: 1,
      items: [
        {
          key: 'cheque_in_due:9:soon:2026-11-12',
          type: 'cheque_in_due',
          phase: 'soon',
          date: '2026-11-12',
          entity: { kind: 'cheque', id: 9, direction: 'in', chequeNo: '5501' },
          params: { chequeNo: '5501', amount: 50000 },
          text: 'شيك رقم 5501 من «د. أحمد سالم» بمبلغ 500.00 ₪ يستحق في 2026-11-12.',
          seen: true,
        },
      ],
    },
    { type: 'cheque_out_due', total: 0, unread: 0, items: [] },
  ],
  ...over,
});

const renderBell = () =>
  renderRoutes(
    [
      { path: '/', element: <NotificationBell /> },
      { path: '/cases/:id', element: <p>case page</p> },
      { path: '/cheques', element: <p>cheques page</p> },
    ],
    '/',
  );

describe('NotificationBell (B5)', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is not shown without notifications.read', async () => {
    const calls = stubApi({ 'GET /api/v1/auth/me': me(['cases.read']) });
    renderBell();
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/v1/auth/me')).toBe(true));
    expect(screen.queryByRole('button', { name: /^الإشعارات/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.key.includes('/notifications'))).toBe(false);
  });

  it('the unread count is in the button name; opening shows the groups and marks the feed read', async () => {
    const calls = stubApi({
      'GET /api/v1/auth/me': me(['notifications.read', 'cases.read', 'cheques.read']),
      'GET /api/v1/notifications/count': () => json(200, { unread: 2, total: 3 }),
      'GET /api/v1/notifications': () => json(200, feed()),
      'PATCH /api/v1/notifications/state': () => new Response(null, { status: 204 }),
    });
    renderBell();
    const bell = await screen.findByRole('button', { name: 'الإشعارات، إشعاران غير مقروءين' });
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('2');
    await userEvent.click(bell);
    const panel = await screen.findByRole('dialog', { name: 'الإشعارات' });
    const cases = await within(panel).findByRole('region', { name: 'حالات اقترب موعدها أو تأخرت (2)' });
    expect(within(cases).getByRole('link', { name: /^جديد: الحالة رقم 1288/ })).toHaveAttribute('href', '/cases/41');
    expect(within(cases).getByText('متأخر')).toBeInTheDocument();
    expect(within(cases).getByText('وإشعار آخر في القائمة')).toBeInTheDocument();
    const cheques = within(panel).getByRole('region', { name: 'شيكات واردة تستحق (1)' });
    // Seen before: no «جديد».
    expect(within(cheques).getByRole('link', { name: /^شيك رقم 5501/ })).toHaveAttribute(
      'href',
      '/cheques?direction=in&q=5501',
    );
    // An empty group is left out.
    expect(within(panel).queryByRole('region', { name: /شيكات صادرة/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(calls.find((c) => c.key === 'PATCH /api/v1/notifications/state')?.body ?? '{}')).toEqual({
        all: true,
        seen: true,
      }),
    );
    // Esc closes and gives the focus back to the bell.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^الإشعارات/ })).toHaveFocus();
  });

  it('«إخفاء» hides one item by its key', async () => {
    const calls = stubApi({
      'GET /api/v1/auth/me': me(['notifications.read', 'cases.read', 'cheques.read']),
      'GET /api/v1/notifications/count': () => json(200, { unread: 0, total: 3 }),
      'GET /api/v1/notifications': () => json(200, feed()),
      'PATCH /api/v1/notifications/state': () => new Response(null, { status: 204 }),
    });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'الإشعارات' }));
    const panel = await screen.findByRole('dialog', { name: 'الإشعارات' });
    await userEvent.click(await within(panel).findByRole('button', { name: /^إخفاء: شيك رقم 5501/ }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'PATCH /api/v1/notifications/state').map((c) => JSON.parse(c.body) as unknown)).toContainEqual({
        keys: ['cheque_in_due:9:soon:2026-11-12'],
        dismissed: true,
      }),
    );
  });

  it('empty feed and load error (with a retry) inside the panel', async () => {
    let fail = true;
    stubApi({
      'GET /api/v1/auth/me': me(['notifications.read', 'cases.read']),
      'GET /api/v1/notifications/count': () => json(200, { unread: 0, total: 0 }),
      'GET /api/v1/notifications': () => {
        if (fail) {
          fail = false;
          return json(500, envelope('error.internal', 'خطأ'));
        }
        return json(200, feed({ unread: 0, total: 0, groups: [{ type: 'case_due', total: 0, unread: 0, items: [] }] }));
      },
      'PATCH /api/v1/notifications/state': () => new Response(null, { status: 204 }),
    });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'الإشعارات' }));
    const panel = await screen.findByRole('dialog', { name: 'الإشعارات' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('تعذّر تحميل الإشعارات.');
    await userEvent.click(within(panel).getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await within(panel).findByText('لا توجد إشعارات')).toBeInTheDocument();
  });
});
