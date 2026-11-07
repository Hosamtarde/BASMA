import createClient from 'openapi-fetch';
import type { Middleware } from 'openapi-fetch';
import { currentLanguage, i18next } from '@/i18n/i18n';
import { NetworkError, toApiError } from './errors';
import type { paths } from './schema.gen';
import { session } from './session';

/**
 * Typed client generated from apps/api/openapi.json (never hand-written types). Same origin in
 * development (Vite proxy) and in the installed app (ADR-0017), so paths are absolute `/api/v1/…`.
 */
export const api = createClient<paths>({
  baseUrl: globalThis.location.origin,
  credentials: 'same-origin',
  // Resolved per call, not captured at start-up.
  fetch: (request: Request) => globalThis.fetch(request),
});

/** Every request names the UI language so server messages come back localized (SPEC §6.1). */
const language: Middleware = {
  onRequest({ request }) {
    request.headers.set('Accept-Language', currentLanguage());
    return request;
  },
};
api.use(language);

/** Routes that must never trigger a silent refresh (they are the refresh, or need no session). */
const NO_REFRESH = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/setup'];
/** Untouched copies for the single retry after a refresh (fetch consumes the original body). */
const retryCopies = new WeakMap<Request, Request>();

/**
 * Bearer token on every request; on 401 one silent refresh (shared by all callers) and one
 * retry with the new token. If the refresh is refused the 401 goes through and the session ends.
 */
const auth: Middleware = {
  onRequest({ request }) {
    const token = session.token();
    if (token !== null) request.headers.set('Authorization', `Bearer ${token}`);
    retryCopies.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    const path = new URL(request.url).pathname;
    const copy = retryCopies.get(request);
    retryCopies.delete(request);
    if (response.status !== 401 || copy === undefined || NO_REFRESH.some((p) => path.startsWith(p))) {
      return response;
    }
    if (!(await session.refresh(currentLanguage()))) return response;
    copy.headers.set('Authorization', `Bearer ${session.token() ?? ''}`);
    return globalThis.fetch(copy);
  },
};
api.use(auth);

/** Network failures become one typed error the UI can show as the "API down" banner. */
const network: Middleware = {
  onError({ error }) {
    return new NetworkError(error);
  },
};
api.use(network);

/** `{ data, error, response }` → data, or throws ApiError / NetworkError. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok || error !== undefined) {
    throw toApiError(response.status, error, i18next.t('errors.unexpected'));
  }
  return data as T;
}
