import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api/errors';
import { initI18n } from '@/i18n/i18n';
import { renderRoutes } from '@/test/render';
import { RouteError } from './errors';
import { apiDown, reportError, staleDialog } from './feedback';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn() }),
}));

const apiError = (status: number, code: string) =>
  new ApiError(status, { code, message: `server says ${code}`, params: {}, correlationId: 'ref-42' });

function Boom({ error }: { error: unknown }): never {
  throw error;
}
const renderError = (error: unknown) =>
  renderRoutes([{ path: '/', element: <Boom error={error} />, errorElement: <RouteError /> }]);

describe('route error boundary', () => {
  beforeEach(async () => {
    await initI18n('ar');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('403 → the "no access" page', () => {
    renderError(apiError(403, 'error.auth.forbidden'));
    expect(screen.getByRole('heading', { name: 'لا تملك صلاحية لهذه الصفحة' })).toBeInTheDocument();
  });

  it('404 → the not-found page with a way home', () => {
    renderError(apiError(404, 'error.not_found'));
    expect(screen.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'العودة إلى الرئيسية' })).toHaveAttribute('href', '/');
  });

  it('5xx → a generic page with the reference to copy, never a stack trace', () => {
    renderError(apiError(500, 'error.internal'));
    expect(screen.getByRole('heading', { name: 'تعذّر عرض هذه الصفحة' })).toBeInTheDocument();
    expect(screen.getByText('ref-42')).toBeInTheDocument();
    expect(screen.queryByText(/at \w+ \(/)).toBeNull();
  });

  it('API unreachable → the full "try again" page', () => {
    renderError(new NetworkError());
    expect(screen.getByRole('alert')).toHaveTextContent('لا يمكن الاتصال بالبرنامج');
  });
});

describe('reportError (errors not shown inline)', () => {
  beforeEach(async () => {
    await initI18n('ar');
    apiDown.set(false);
    staleDialog.set(false);
    toastError.mockClear();
  });

  it('network → banner, stale → dialog, 401 → nothing (session expiry handles it)', () => {
    reportError(new NetworkError());
    expect(apiDown.get()).toBe(true);
    reportError(apiError(409, 'error.concurrency.stale'));
    expect(staleDialog.get()).toBe(true);
    reportError(apiError(401, 'error.auth.unauthenticated'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('5xx → toast with the reference and a copy action; 429 → toast with the message', () => {
    reportError(apiError(500, 'error.internal'));
    expect(toastError).toHaveBeenCalledWith(
      'server says error.internal',
      expect.objectContaining({
        description: 'رقم المتابعة: ref-42',
        action: expect.objectContaining({ label: 'نسخ' }),
      }),
    );
    reportError(apiError(429, 'error.rate_limited'));
    expect(toastError).toHaveBeenLastCalledWith('server says error.rate_limited');
  });
});
