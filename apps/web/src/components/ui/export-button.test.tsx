import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNameOf } from '@/api/download';
import { resetSessionForTests, session } from '@/api/session';
import { exportApi } from '@/features/payments/api';
import { initI18n } from '@/i18n/i18n';
import { envelope, json, renderPage, stubApi } from '@/test/render';
import { ExportButton } from './export-button';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const me = (permissions: string[]) => () =>
  json(200, { id: 1, username: 'owner', permissions, mustChangePassword: false });
const BOM_CSV = '\uFEFFالطبيب,المبلغ\r\nد. أحمد,12.30\r\n';
const csv = () =>
  new Response(BOM_CSV, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="basma-debts-2026-11-16.csv"',
      'X-Export-Rows': '1',
    },
  });

describe('fileNameOf', () => {
  it('reads the quoted ASCII name and falls back', () => {
    expect(fileNameOf('attachment; filename="a-b.csv"', 'x.csv')).toBe('a-b.csv');
    expect(fileNameOf(null, 'x.csv')).toBe('x.csv');
    expect(fileNameOf('attachment; filename="../evil.csv"', 'x.csv')).toBe('x.csv');
  });
});

describe('ExportButton', () => {
  const saved: { download: string; href: string }[] = [];
  let blobs: Blob[] = [];

  beforeEach(async () => {
    resetSessionForTests();
    session.set({ accessToken: 't' });
    await initI18n('ar');
    saved.length = 0;
    blobs = [];
    toast.success.mockClear();
    toast.error.mockClear();
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ download: this.download, href: this.href });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = () => exportApi.debts({ search: '', direction: 'all' });

  it('downloads the file under the server’s name with the BOM intact and tells how many rows', async () => {
    const calls = stubApi({ 'GET /api/v1/auth/me': me(['exports.run']), 'GET /api/v1/exports/debts': csv });
    renderPage(<ExportButton run={run} />);
    await userEvent.click(await screen.findByRole('button', { name: 'تصدير CSV' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ download: 'basma-debts-2026-11-16.csv', href: 'blob:test' });
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(calls.some((c) => c.key === 'GET /api/v1/exports/debts')).toBe(true);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test'));
  });

  it('sends the screen’s filters and the UI language to the server', async () => {
    let url = '';
    let lang = '';
    stubApi({
      'GET /api/v1/auth/me': me(['exports.run']),
      'GET /api/v1/exports/debts': (req) => {
        url = new URL(req.url).search;
        lang = req.headers.get('Accept-Language') ?? '';
        return csv();
      },
    });
    renderPage(<ExportButton run={() => exportApi.debts({ search: 'سالم', direction: 'owed_to_lab' })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'تصدير CSV' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(new URLSearchParams(url).get('direction')).toBe('owed_to_lab');
    expect(new URLSearchParams(url).get('search')).toBe('سالم');
    expect(lang).toBe('ar');
  });

  it('says to narrow the filters when the file is too large (422), and saves nothing', async () => {
    stubApi({
      'GET /api/v1/auth/me': me(['exports.run']),
      'GET /api/v1/exports/debts': () =>
        json(422, envelope('error.export.too_large', 'الملف كبير جداً. ضيّق الفلاتر ثم أعد التصدير.')),
    });
    renderPage(<ExportButton run={run} />);
    await userEvent.click(await screen.findByRole('button', { name: 'تصدير CSV' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('الملف كبير جداً. ضيّق الفلاتر ثم أعد التصدير.'));
    expect(saved).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('is hidden without exports.run, and without an extra permission it needs', async () => {
    stubApi({ 'GET /api/v1/auth/me': me(['ledger.read']) });
    const { unmount } = renderPage(<ExportButton run={run} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'تصدير CSV' })).toBeNull();
    unmount();
    stubApi({ 'GET /api/v1/auth/me': me(['exports.run']) });
    renderPage(<ExportButton run={run} needs={['cases.read']} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'تصدير CSV' })).toBeNull();
  });

  it('stays visible but disabled with its reason when there is nothing to export', async () => {
    const calls = stubApi({ 'GET /api/v1/auth/me': me(['exports.run']), 'GET /api/v1/exports/debts': csv });
    renderPage(<ExportButton run={run} disabledReason="لا توجد بيانات للتصدير بهذه التصفية." />);
    const button = await screen.findByRole('button', { name: 'تصدير CSV' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('لا توجد بيانات للتصدير بهذه التصفية.');
    await userEvent.click(button);
    expect(calls.some((c) => c.key === 'GET /api/v1/exports/debts')).toBe(false);
  });
});
