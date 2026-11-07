import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from '@/api/errors';
import { apiDown, reportError } from './feedback';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The form shows validation and business errors inline; only global cases are reported. */
      inlineErrors?: boolean;
    };
  }
}

/** Errors a form shows itself; stale, server, network and session errors stay global. */
const INLINE_KINDS = new Set(['validation', 'conflict', 'forbidden', 'notFound', 'rateLimited', 'other']);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err) => {
        if (err instanceof NetworkError) apiDown.set(true);
      },
      onSuccess: () => apiDown.set(false),
    }),
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.meta?.inlineErrors && err instanceof ApiError && INLINE_KINDS.has(err.kind)) return;
        reportError(err);
      },
      onSuccess: () => apiDown.set(false),
    }),
    defaultOptions: {
      queries: {
        // API errors are answers, not glitches; only an unreachable API is retried (once).
        retry: (failures, err) => err instanceof NetworkError && failures < 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        // 403/404/5xx while loading a page go to that route's error boundary.
        throwOnError: (err) =>
          err instanceof ApiError &&
          (err.kind === 'forbidden' || err.kind === 'notFound' || err.kind === 'server'),
      },
      mutations: { retry: false },
    },
  });
}
