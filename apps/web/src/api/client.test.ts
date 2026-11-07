import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { changeLanguage, initI18n } from '@/i18n/i18n';
import { api, unwrap } from './client';
import { ApiError, NetworkError } from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const envelope = (code: string, message = 'msg', extra: object = {}) => ({
  error: { code, message, params: {}, correlationId: 'abc-123', ...extra },
});

describe('api client', () => {
  beforeAll(async () => {
    await initI18n('ar');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Accept-Language in the current UI language', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { setupRequired: false })));
    vi.stubGlobal('fetch', fetchMock);
    await changeLanguage('en');
    const data = await unwrap(api.GET('/api/v1/setup/status'));
    expect(data).toEqual({ setupRequired: false });
    const request = (fetchMock.mock.calls[0] as unknown as [Request])[0];
    expect(request.url).toMatch(/\/api\/v1\/setup\/status$/);
    expect(request.headers.get('Accept-Language')).toBe('en');
    await changeLanguage('ar');
  });

  it.each([
    [400, 'error.validation.failed', 'validation'],
    [401, 'error.auth.unauthenticated', 'unauthenticated'],
    [403, 'error.auth.forbidden', 'forbidden'],
    [404, 'error.not_found', 'notFound'],
    [409, 'error.concurrency.stale', 'stale'],
    [409, 'error.case.cannot_cancel', 'conflict'],
    [429, 'error.rate_limited', 'rateLimited'],
    [500, 'error.internal', 'server'],
  ])('maps %i %s to the "%s" handling', async (status, code, kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(status, envelope(code)))),
    );
    const err = await unwrap(api.GET('/api/v1/setup/status')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, code, kind, message: 'msg', correlationId: 'abc-123' });
  });

  it('keeps the per-field validation details', async () => {
    const body = envelope('error.validation.failed', 'bad', {
      details: { fields: [{ field: 'lab.phone', constraints: ['matches'] }] },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(400, body))),
    );
    const err = (await unwrap(api.GET('/api/v1/setup/status')).catch((e: unknown) => e)) as ApiError;
    expect(err.fields).toEqual([{ field: 'lab.phone', constraints: ['matches'] }]);
  });

  it('gives a stable code when a response has no envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))),
    );
    const err = (await unwrap(api.GET('/api/v1/setup/status')).catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({
      status: 502,
      code: 'error.internal',
      kind: 'server',
      message: 'حدث خطأ غير متوقع.',
    });
  });

  it('turns an unreachable API into a NetworkError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(unwrap(api.GET('/api/v1/setup/status'))).rejects.toBeInstanceOf(NetworkError);
  });
});
