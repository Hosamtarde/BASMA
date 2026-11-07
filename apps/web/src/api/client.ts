import createClient from 'openapi-fetch';
import type { Middleware } from 'openapi-fetch';
import { currentLanguage, i18next } from '@/i18n/i18n';
import { NetworkError, toApiError } from './errors';
import type { paths } from './schema.gen';

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
