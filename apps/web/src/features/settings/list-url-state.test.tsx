import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { DoctorsPage } from '@/features/doctors/DoctorsPage';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { json, renderRoutes, stubApi } from '@/test/render';
import { ExpenseCategoriesPage, TechniciansPage, WorkTypesPage } from './ListPages';

const empty = { page: 1, pageSize: 25, total: 0, items: [] };

function Address() {
  return <output aria-label="address">{useLocation().search}</output>;
}

/** The F1 lists keep search, status and page in the address through useUrlState (as the case list). */
const LISTS: [string, string, string, () => ReactElement][] = [
  ['doctors', '/doctors', 'ابحث بالاسم أو العيادة أو الهاتف', () => <DoctorsPage />],
  ['work types', '/api/v1/work-types', 'ابحث في أنواع العمل', () => <WorkTypesPage />],
  ['technicians', '/api/v1/technicians', 'ابحث في الفنيين', () => <TechniciansPage />],
  ['expense categories', '/api/v1/expense-categories', 'ابحث في الفئات', () => <ExpenseCategoriesPage />],
];

describe.each(LISTS)('%s list: state in the address', (_name, endpoint, searchLabel, page) => {
  const api = endpoint.startsWith('/api') ? endpoint : `/api/v1${endpoint}`;
  let requests: URL[];

  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
    requests = [];
    stubApi({
      'GET /api/v1/settings': () => json(200, settingsFixture()),
      [`GET ${api}`]: (req) => {
        requests.push(new URL(req.url));
        return json(200, empty);
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const render = (path = '/list') =>
    renderRoutes(
      [
        {
          path: '/list',
          element: (
            <>
              {page()}
              <Address />
            </>
          ),
        },
      ],
      path,
    );
  const address = () => screen.getByRole('status', { name: 'address' });

  it('starts from the address and asks the API for it', async () => {
    render('/list?q=sami&status=all&page=2');
    expect(await screen.findByRole('searchbox', { name: searchLabel })).toHaveValue('sami');
    expect(screen.getByRole('combobox', { name: 'الحالة' })).toHaveValue('all');
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('search')).toBe('sami'));
    expect(requests.at(-1)?.searchParams.get('page')).toBe('2');
    expect(requests.at(-1)?.searchParams.has('active')).toBe(false);
  });

  it('answers a status change at once, keeps a quick search too, and never writes half-typed text', async () => {
    render();
    const status = await screen.findByRole('combobox', { name: 'الحالة' });
    await userEvent.selectOptions(status, 'inactive');
    // The control shows the new value immediately (not after the URL round trip).
    expect(status).toHaveValue('inactive');
    await userEvent.type(screen.getByRole('searchbox', { name: searchLabel }), 'ab');
    // Still typing: the address has the status but not the half-typed search.
    expect(address().textContent).not.toContain('q=');
    await waitFor(() => expect(address()).toHaveTextContent('?q=ab&status=inactive'));
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('search')).toBe('ab'));
    expect(requests.at(-1)?.searchParams.get('active')).toBe('false');
  });

  it('adopts a navigation made elsewhere (back/forward, a link) in the controls', async () => {
    const { router } = render('/list?status=inactive');
    const status = await screen.findByRole('combobox', { name: 'الحالة' });
    expect(status).toHaveValue('inactive');
    await act(() => router.navigate('/list?q=zz'));
    await waitFor(() => expect(status).toHaveValue('active'));
    expect(screen.getByRole('searchbox', { name: searchLabel })).toHaveValue('zz');
  });
});
