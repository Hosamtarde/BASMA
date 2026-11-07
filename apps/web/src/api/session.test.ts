import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n/i18n';
import { api, unwrap } from './client';
import { ApiError, NetworkError } from './errors';
import { resetSessionForTests, session } from './session';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unauthenticated = () =>
  json(401, { error: { code: 'error.auth.unauthenticated', message: 'x', params: {}, correlationId: 'c' } });
const tokens = (n: number) => ({
  accessToken: `token-${n}`,
  accessTokenExpiresIn: 900,
  refreshTokenExpiresAt: '2026-12-07T00:00:00.000Z',
  mustChangePassword: false,
});

/** A fake API: /auth/refresh answers from `refreshResults`; /auth/me needs "token-2". */
function fakeApi(refreshResults: (() => Response)[]) {
  const calls: { path: string; auth: string | null }[] = [];
  const fetchMock = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push({ path, auth: request.headers.get('Authorization') });
    if (path === '/api/v1/auth/refresh') {
      await new Promise((r) => setTimeout(r, 5));
      return (refreshResults.shift() ?? unauthenticated)();
    }
    if (request.headers.get('Authorization') === 'Bearer token-2') {
      return json(200, { id: 1, username: 'owner', permissions: [], mustChangePassword: false });
    }
    return unauthenticated();
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('session and silent refresh', () => {
  beforeAll(async () => {
    await initI18n('ar');
  });
  beforeEach(() => {
    resetSessionForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the access token in memory only', () => {
    session.set({ accessToken: 'token-1' });
    expect(session.token()).toBe('token-1');
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('refreshes once for many concurrent 401s, then retries each request with the new token', async () => {
    session.set({ accessToken: 'token-1' });
    const calls = fakeApi([() => json(200, tokens(2))]);
    const results = await Promise.all([1, 2, 3].map(() => unwrap(api.GET('/api/v1/auth/me'))));
    expect(results.map((r) => r.username)).toEqual(['owner', 'owner', 'owner']);
    expect(calls.filter((c) => c.path === '/api/v1/auth/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.auth === 'Bearer token-2')).toHaveLength(3);
    expect(session.token()).toBe('token-2');
  });

  it('ends the session when the refresh cookie is refused, and says so once', async () => {
    session.set({ accessToken: 'token-1' });
    fakeApi([unauthenticated]);
    const expired = vi.fn();
    session.onExpired(expired);
    const err = await unwrap(api.GET('/api/v1/auth/me')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('unauthenticated');
    expect(session.token()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('restores a session after a reload from the cookie alone', async () => {
    fakeApi([() => json(200, tokens(2))]);
    await expect(session.refresh('ar')).resolves.toBe(true);
    expect(session.token()).toBe('token-2');
  });

  it('does not report an expiry when there was no session to restore', async () => {
    fakeApi([unauthenticated]);
    const expired = vi.fn();
    session.onExpired(expired);
    await expect(session.refresh('ar')).resolves.toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it('never refreshes for the login request itself', async () => {
    const calls = fakeApi([() => json(200, tokens(2))]);
    await unwrap(api.POST('/api/v1/auth/login', { body: { username: 'a', password: 'b' } })).catch(
      () => undefined,
    );
    expect(calls.map((c) => c.path)).toEqual(['/api/v1/auth/login']);
  });

  it('keeps the session when the API is unreachable during a refresh', async () => {
    session.set({ accessToken: 'token-1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(session.refresh('ar')).rejects.toBeInstanceOf(NetworkError);
    expect(session.token()).toBe('token-1');
  });
});
