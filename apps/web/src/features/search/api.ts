import { queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components } from '@/api/schema.gen';

export type SearchResponse = components['schemas']['SearchResponse'];

/** Hits per group in the dialog; «عرض الكل» opens the full list with the same text. */
export const SEARCH_LIMIT = 5;

/** Shorter than this is not searched (a single digit is: case and voucher numbers). */
export function isSearchable(text: string): boolean {
  const t = text.trim();
  return [...t].length >= 2 || /^\d$/.test(t);
}

export const searchKeys = { all: ['search'] as const, text: (q: string) => ['search', q] as const };

/** The server filters (folded Arabic, closest matches); the signal cancels a request that is outdated. */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: searchKeys.text(q),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/search', { params: { query: { q, limit: SEARCH_LIMIT } }, signal })),
    staleTime: 10_000,
  });
