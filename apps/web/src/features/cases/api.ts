import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { components, paths } from '@/api/schema.gen';
import { PAGE_SIZE } from '@/features/catalog/api';

export type CaseSummary = components['schemas']['CaseSummaryResponse'];
export type CaseDetail = components['schemas']['CaseDetailResponse'];
export type CaseLine = components['schemas']['CaseLineResponse'];
export type CaseHistory = components['schemas']['CaseHistoryResponse'];
export type CaseStatus = CaseSummary['status'];
export type CaseLineInput = components['schemas']['CaseLineInput'];
export type CreateCase = components['schemas']['CreateCaseRequest'];
export type UpdateCase = components['schemas']['UpdateCaseRequest'];
export type UpdateCaseLine = components['schemas']['UpdateCaseLineRequest'];
export type ChangeCaseStatus = components['schemas']['ChangeCaseStatusRequest'];
export type InitialStatus = NonNullable<CreateCase['status']>;

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

export const caseQuery = (id: number) =>
  queryOptions({
    queryKey: caseKeys.one(id),
    queryFn: () => unwrap(api.GET('/api/v1/cases/{id}', { params: { path: { id } } })),
  });

const byId = (id: number) => ({ params: { path: { id } } });

/** Every write returns the whole case with its new rowVersion; callers store it (chaining). */
export const caseApi = {
  create: (body: CreateCase) => unwrap(api.POST('/api/v1/cases', { body })),
  update: (id: number, body: UpdateCase) => unwrap(api.PATCH('/api/v1/cases/{id}', { ...byId(id), body })),
  addLines: (id: number, rowVersion: number, lines: CaseLineInput[]) =>
    unwrap(api.POST('/api/v1/cases/{id}/lines', { ...byId(id), body: { rowVersion, lines } })),
  updateLine: (id: number, lineId: number, body: UpdateCaseLine) =>
    unwrap(
      api.PATCH('/api/v1/cases/{id}/lines/{lineId}', { params: { path: { id, lineId } }, body }),
    ),
  removeLine: (id: number, lineId: number, rowVersion: number) =>
    unwrap(
      api.DELETE('/api/v1/cases/{id}/lines/{lineId}', {
        params: { path: { id, lineId }, query: { rowVersion } },
      }),
    ),
  changeStatus: (id: number, body: ChangeCaseStatus) =>
    unwrap(api.POST('/api/v1/cases/{id}/status', { ...byId(id), body })),
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
    queryClient.invalidateQueries({ queryKey: ['settings'] }),
  ]);
}
