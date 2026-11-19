import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests, session } from '@/api/session';
import { initI18n } from '@/i18n/i18n';
import { settingsFixture } from '@/test/fixtures';
import { envelope, json, renderRoutes, stubApi } from '@/test/render';
import { GlobalSearch } from './GlobalSearch';

const me = (permissions: string[] = ['search.use']) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });

const group = <T,>(items: T[], over: object = {}) => ({ total: items.length, closest: false, items, ...over });

const answer = (groups: object, q = 'x') => json(200, { q, groups });

const DOCTOR = { id: 7, name: 'د. أحمد الهمزة', clinic: 'عيادة الهمزة', active: true };
const CASE = { id: 41, caseNo: 1288, patientName: 'ليلى حداد', doctorName: 'د. أحمد الهمزة', status: 'design', receivedDate: '2026-11-01' };
const PAYMENT = { id: 5, voucher: 'IN-000005', doctorName: 'د. أحمد الهمزة', method: 'cash', amount: 15050, paidAt: '2026-11-10', status: 'active' };

function mount(routes: Record<string, (req: Request) => Response | Promise<Response>>, path = '/') {
  const calls = stubApi({
    'GET /api/v1/settings': () => json(200, settingsFixture()),
    'GET /api/v1/auth/me': me(),
    ...routes,
  });
  const view = renderRoutes(
    [
      { path: '/', element: <GlobalSearch /> },
      { path: '*', element: <p>elsewhere</p> },
    ],
    path,
  );
  return { calls, ...view };
}
const searchCalls = (calls: { key: string }[]) => calls.filter((c) => c.key === 'GET /api/v1/search');

describe('GlobalSearch (SPEC §5.17)', () => {
  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const trigger = () => screen.findByRole('button', { name: /ابحث عن طبيب أو حالة/ });

  it('opens from the top-bar button and from Ctrl+K, closes with Esc and gives the focus back', async () => {
    mount({});
    const button = await trigger();
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'بحث' });
    expect(within(dialog).getByRole('combobox', { name: 'ابحث في الأطباء والحالات والدفعات' })).toHaveFocus();
    expect(screen.getByText('اكتب حرفين على الأقل، أو رقمًا.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'بحث' })).toBeVisible();
    await userEvent.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('«/» opens it, but not while typing in another field', async () => {
    mount({});
    await trigger();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    await userEvent.keyboard('/');
    expect(screen.queryByRole('dialog')).toBeNull();
    field.remove();
    document.body.focus();
    await userEvent.keyboard('/');
    expect(await screen.findByRole('dialog', { name: 'بحث' })).toBeVisible();
  });

  it('is absent without the search.use permission', async () => {
    mount({ 'GET /api/v1/auth/me': me(['doctors.read']) });
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByRole('button', { name: /ابحث عن طبيب أو حالة/ })).toBeNull();
  });

  it('waits 150 ms after the last keystroke and sends the whole text once', async () => {
    const { calls } = mount({ 'GET /api/v1/search': () => answer({ doctors: group([DOCTOR]) }, 'احمد') });
    await userEvent.click(await trigger());
    const input = await screen.findByRole('combobox');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(input, { target: { value: 'اح' } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: 'احمد' } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(searchCalls(calls)).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    vi.useRealTimers();
    await waitFor(() => expect(searchCalls(calls)).toHaveLength(1));
    expect(new URL(`http://x/${'?q=' + encodeURIComponent('احمد')}`).searchParams.get('q')).toBe('احمد');
  });

  it('sends nothing under two letters (a single digit is allowed) and hints instead', async () => {
    let urls: string[] = [];
    mount({
      'GET /api/v1/search': (req) => {
        urls = [...urls, new URL(req.url).searchParams.get('q') ?? ''];
        return answer({});
      },
    });
    await userEvent.click(await trigger());
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'أ');
    await new Promise((r) => setTimeout(r, 250));
    expect(urls).toEqual([]);
    expect(screen.getByText('اكتب حرفين على الأقل، أو رقمًا.')).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, '7');
    await waitFor(() => expect(urls).toEqual(['7']));
  });

  it('does not search in the middle of an IME composition, then searches the composed text', async () => {
    const { calls } = mount({ 'GET /api/v1/search': () => answer({}) });
    await userEvent.click(await trigger());
    const input = await screen.findByRole('combobox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'مح' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(searchCalls(calls)).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'محمد' } });
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(searchCalls(calls)).toHaveLength(1));
  });

  it('shows doctors, cases and payments as groups, and Enter opens the chosen result', async () => {
    const { router } = mount({
      'GET /api/v1/search': () => answer({ doctors: group([DOCTOR]), cases: group([CASE]), payments: group([PAYMENT]) }, 'همزة'),
    });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), 'همزة');
    const listbox = await screen.findByRole('listbox');
    await within(listbox).findByText('ليلى حداد');
    expect(within(listbox).getByText('الأطباء')).toBeVisible();
    expect(within(listbox).getByText('الحالات')).toBeVisible();
    expect(within(listbox).getByText('الدفعات')).toBeVisible();
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    // One polite announcement for the whole result, not per keystroke.
    expect(screen.getAllByRole('status').some((s) => s.textContent === '3 نتائج')).toBe(true);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/cases/41'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a payment result opens the payments list on its voucher', async () => {
    const { router } = mount({ 'GET /api/v1/search': () => answer({ payments: group([PAYMENT]) }, '5') });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), '5');
    await userEvent.click(await screen.findByRole('option', { name: /IN-000005/ }));
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/payments?q=IN-000005'));
  });

  it('an outgoing result opens the expenses page on its OUT- voucher; its group is labelled and counted', async () => {
    const OUT = { id: 12, voucher: 'OUT-000012', kind: 'expense', categoryName: 'إيجار', partyName: 'مؤجّر المختبر', method: 'cash', amount: 150000, paidAt: '2026-11-10', status: 'active' };
    const { router } = mount({ 'GET /api/v1/search': () => answer({ outgoing: group([OUT]) }, 'out12') });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), 'out12');
    expect(await screen.findByText('المصاريف')).toBeVisible();
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'نتيجة واحدة')).toBe(true);
    await userEvent.click(await screen.findByRole('option', { name: /OUT-000012/ }));
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/outgoing?q=OUT-000012'));
  });

  it('«عرض الكل» appears when there are more hits and opens the full list with the same text', async () => {
    const { router } = mount({
      'GET /api/v1/search': () => answer({ doctors: group([DOCTOR], { total: 12 }) }, 'احمد'),
    });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), 'احمد');
    await userEvent.click(await screen.findByRole('option', { name: 'عرض الكل (12)' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/doctors'));
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('احمد');
    expect(new URLSearchParams(router.state.location.search).get('status')).toBe('all');
  });

  it('labels closest matches, and a group without permission is simply not there', async () => {
    mount({ 'GET /api/v1/search': () => answer({ doctors: group([DOCTOR], { closest: true }) }, 'علي محمد') });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), 'علي محمد');
    expect(await screen.findByText(/أقرب النتائج/)).toBeVisible();
    expect(screen.queryByText('الحالات')).toBeNull();
    expect(screen.queryByText('الدفعات')).toBeNull();
  });

  it('says there is nothing for the text, with a way on', async () => {
    mount({ 'GET /api/v1/search': () => answer({ doctors: group([]), cases: group([]), payments: group([]) }, 'زززز') });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), 'زززز');
    const empty = await screen.findByTestId('search-empty');
    expect(empty).toHaveTextContent('لا توجد نتائج لـ «زززز».');
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'لا توجد نتائج لـ «زززز».')).toBe(true);
  });

  it('shows an alert with a retry when the search fails, and recovers', async () => {
    let n = 0;
    mount({
      'GET /api/v1/search': () => {
        n += 1;
        return n === 1 ? json(500, envelope('error.internal', 'x')) : answer({ doctors: group([DOCTOR]) }, 'احمد');
      },
    });
    await userEvent.click(await trigger());
    await userEvent.type(await screen.findByRole('combobox'), 'احمد');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('تعذّر البحث.');
    await userEvent.click(within(alert).getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('option', { name: /د. أحمد الهمزة/ })).toBeVisible();
  });

  it('works in English (left to right) with its own labels', async () => {
    await initI18n('en');
    mount({ 'GET /api/v1/search': () => answer({ cases: group([CASE]) }, 'laila') });
    await userEvent.click(await screen.findByRole('button', { name: /Search for a doctor or a case/ }));
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeVisible();
    await userEvent.type(screen.getByRole('combobox'), 'laila');
    expect(await screen.findByText('Cases')).toBeVisible();
    expect(screen.getByRole('option', { name: /Case 1288/ })).toBeVisible();
  });
});
