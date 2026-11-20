import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components, paths } from '@/api/schema.gen';
import { PAGE_SIZE } from '@/features/catalog/api';

export type CaseSummary = components['schemas']['CaseListItemResponse'];
export type CaseDetail = components['schemas']['CaseDetailResponse'];
export type CreateCaseResponse = components['schemas']['CreateCaseResponse'];
export type CaseLine = components['schemas']['CaseLineResponse'];
export type CaseHistory = components['schemas']['CaseHistoryResponse'];
export type CaseStatus = CaseSummary['status'];
export type CaseLineInput = components['schemas']['CaseLineInput'];
export type CreateCase = components['schemas']['CreateCaseRequest'];
export type UpdateCase = components['schemas']['UpdateCaseRequest'];
export type UpdateCaseLine = components['schemas']['UpdateCaseLineRequest'];
export type ChangeCaseStatus = components['schemas']['ChangeCaseStatusRequest'];
export type DeliverCase = components['schemas']['DeliverCaseRequest'];
export type DeliverCaseResult = components['schemas']['DeliverCaseResponse'];
export type DeliveryReceived = NonNullable<DeliverCase['received']>;
export type InitialStatus = NonNullable<CreateCase['status']>;
export type CaseCounts = components['schemas']['CaseCountsResponse'];
/** The list filters the counts honour (everything except status and paging). */
export type CaseCountFilter = Omit<CaseListParams, 'status' | 'page'>;

/** The order of the case lifecycle (SPEC §9), used for chips and filters. */
export const CASE_STATUSES: readonly CaseStatus[] = [
  'waiting',
  'design',
  'in_progress',
  'ready',
  'delivered',
  'returned',
  'cancelled',
];
/** A new case starts before delivery (the API refuses anything else). */
export const INITIAL_STATUSES: readonly InitialStatus[] = ['waiting', 'design', 'in_progress', 'ready'];
export const DEFAULT_INITIAL_STATUS: InitialStatus = 'design';
/** Same limit as the API DTO; the server stays the authority. */
export const MAX_LINES = 100;

type ListQuery = NonNullable<paths['/api/v1/cases']['get']['parameters']['query']>;
export interface CaseListParams {
  search: string;
  status?: CaseStatus | undefined;
  doctorId?: number | undefined;
  overdue?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
}

export const caseKeys = {
  all: ['cases'] as const,
  lists: ['cases', 'list'] as const,
  list: (p: CaseListParams) => ['cases', 'list', p] as const,
  one: (id: number) => ['cases', 'one', id] as const,
  summaries: ['cases', 'summary'] as const,
  summary: (f: CaseCountFilter) => ['cases', 'summary', f] as const,
};

export const casesQuery = (p: CaseListParams) =>
  queryOptions({
    queryKey: caseKeys.list(p),
    queryFn: () => {
      const query: ListQuery = {
        search: p.search || undefined,
        status: p.status,
        doctorId: p.doctorId,
        overdue: p.overdue || undefined,
        from: p.from,
        to: p.to,
        page: p.page,
        pageSize: PAGE_SIZE,
      };
      return unwrap(api.GET('/api/v1/cases', { params: { query } }));
    },
    placeholderData: keepPreviousData,
  });

/**
 * Cases per status and overdue in one request and one snapshot (GET /cases/summary), with the
 * same filters as the list so the chips always count what the list would show.
 */
export const caseCountsQuery = (f: CaseCountFilter = { search: '' }) =>
  queryOptions({
    queryKey: caseKeys.summary(f),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/cases/summary', {
          params: {
            query: {
              search: f.search || undefined,
              doctorId: f.doctorId,
              overdue: f.overdue || undefined,
              from: f.from,
              to: f.to,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** Shades by use on case lines, for the picker's «الأكثر استخدامًا» row (counts only). */
export const shadeUsageQuery = queryOptions({
  queryKey: [...caseKeys.all, 'shade-usage'] as const,
  queryFn: () => unwrap(api.GET('/api/v1/cases/shade-usage', { params: { query: { limit: 8 } } })),
  // Usage changes slowly; a case saved meanwhile invalidates `caseKeys.all` anyway.
  staleTime: 60_000,
});

/** The newest cases for Home (same order as the list). */
export const latestCasesQuery = (count: number) =>
  queryOptions({
    queryKey: [...caseKeys.lists, 'latest', count] as const,
    queryFn: () => unwrap(api.GET('/api/v1/cases', { params: { query: { page: 1, pageSize: count } } })),
  });

export const caseQuery = (id: number) =>
  queryOptions({
    queryKey: caseKeys.one(id),
    queryFn: () => unwrap(api.GET('/api/v1/cases/{id}', { params: { path: { id } } })),
  });

const byId = (id: number) => ({ params: { path: { id } } });

/** Every write returns the whole case with its new rowVersion; callers store it (chaining). */
export const caseApi = {
  /** `key` (an Idempotency-Key) is required by the API when the body carries an advance payment. */
  create: (body: CreateCase, key?: string) =>
    unwrap(
      api.POST('/api/v1/cases', {
        body,
        params: { header: key ? { 'Idempotency-Key': key } : {} },
      }),
    ),
  update: (id: number, body: UpdateCase) => unwrap(api.PATCH('/api/v1/cases/{id}', { ...byId(id), body })),
  addLines: (id: number, rowVersion: number, lines: CaseLineInput[]) =>
    unwrap(api.POST('/api/v1/cases/{id}/lines', { ...byId(id), body: { rowVersion, lines } })),
  updateLine: (id: number, lineId: number, body: UpdateCaseLine) =>
    unwrap(api.PATCH('/api/v1/cases/{id}/lines/{lineId}', { params: { path: { id, lineId } }, body })),
  removeLine: (id: number, lineId: number, rowVersion: number) =>
    unwrap(
      api.DELETE('/api/v1/cases/{id}/lines/{lineId}', {
        params: { path: { id, lineId }, query: { rowVersion } },
      }),
    ),
  changeStatus: (id: number, body: ChangeCaseStatus) =>
    unwrap(api.POST('/api/v1/cases/{id}/status', { ...byId(id), body })),
  /** B5: the only way to "delivered"; `key` is required when money is taken (received full or partial). */
  deliver: (id: number, body: DeliverCase, key?: string) =>
    unwrap(
      api.POST('/api/v1/cases/{id}/delivery', {
        ...byId(id),
        body,
        params: { path: { id }, header: key ? { 'Idempotency-Key': key } : {} },
      }),
    ),
  setCollectOn: (id: number, rowVersion: number, collectOn: string | null) =>
    unwrap(api.PATCH('/api/v1/cases/{id}/collect-on', { ...byId(id), body: { rowVersion, collectOn } })),
  cancel: (id: number, rowVersion: number, reason: string | null) =>
    unwrap(api.POST('/api/v1/cases/{id}/cancel', { ...byId(id), body: { rowVersion, reason } })),
};

/**
 * After a write: keep the returned case (its rowVersion is the one the next call must send) and
 * refresh the lists. A case's amounts also lock the currency and its number locks numbering.
 */
export async function storeCase(queryClient: QueryClient, saved: CaseDetail): Promise<void> {
  queryClient.setQueryData(caseKeys.one(saved.id), saved);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: caseKeys.lists }),
    queryClient.invalidateQueries({ queryKey: caseKeys.summaries }),
    queryClient.invalidateQueries({ queryKey: ['settings'] }),
    // Due dates and collect dates feed the bell (B5).
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  ]);
}
