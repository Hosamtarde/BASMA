import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { takeFile } from '@/api/download';
import type { components, paths } from '@/api/schema.gen';
import { PAGE_SIZE } from '@/features/catalog/api';

export type OutgoingPayment = components['schemas']['OutgoingPaymentResponse'];
export type OutgoingResult = components['schemas']['OutgoingResultResponse'];
export type CreateOutgoing = components['schemas']['CreateOutgoingPaymentRequest'];
export type OutgoingSummary = components['schemas']['OutgoingSummaryResponse'];
export type CashFlow = components['schemas']['CashFlowResponse'];
export type OutgoingKind = OutgoingPayment['kind'];
export type OutgoingMethod = OutgoingPayment['method'];
export type ChequeStatus = NonNullable<OutgoingPayment['cheque']>['status'];

export const OUTGOING_METHODS: readonly OutgoingMethod[] = ['cash', 'cheque', 'transfer'];
export const OUTGOING_KINDS: readonly OutgoingKind[] = ['expense', 'doctor_refund'];

type OutgoingQuery = NonNullable<paths['/api/v1/outgoing-payments']['get']['parameters']['query']>;

/** The filters of the outgoing list; the address keeps them (see OutgoingPage). */
export interface OutgoingListParams {
  search: string;
  categoryId?: number | undefined;
  kind?: OutgoingKind | undefined;
  method?: OutgoingMethod | undefined;
  status?: 'active' | 'void' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
}

/** The summary, the cash flow and the exports use the list filters except status and paging. */
export type OutgoingFilter = Omit<OutgoingListParams, 'status' | 'page'>;

/** One family for everything outgoing, so one invalidation refreshes list, summaries and panels. */
export const outgoingKeys = {
  all: ['outgoing'] as const,
  lists: ['outgoing', 'list'] as const,
  list: (p: OutgoingListParams) => ['outgoing', 'list', p] as const,
  summary: (f: OutgoingFilter) => ['outgoing', 'summary', f] as const,
  cashFlow: (from: string, to: string) => ['outgoing', 'cash-flow', from, to] as const,
  /** Active categories for the form, inside the expense-categories family (catalog writes refresh it). */
  categories: ['expense-categories', 'outgoing-form'] as const,
  /** Every category (inactive ones too), for the filter: reports keep old categories. */
  allCategories: ['expense-categories', 'outgoing-filter'] as const,
};

export const outgoingQuery = (p: OutgoingListParams) =>
  queryOptions({
    queryKey: outgoingKeys.list(p),
    queryFn: () => {
      const query: OutgoingQuery = {
        search: p.search || undefined,
        categoryId: p.categoryId,
        kind: p.kind,
        method: p.method,
        status: p.status,
        from: p.from,
        to: p.to,
        page: p.page,
        pageSize: PAGE_SIZE,
      };
      return unwrap(api.GET('/api/v1/outgoing-payments', { params: { query } }));
    },
    placeholderData: keepPreviousData,
  });

/** Totals per category on the effective date («حسب تاريخ الصرف»), same filters as the table. */
export const outgoingSummaryQuery = (f: OutgoingFilter) =>
  queryOptions({
    queryKey: outgoingKeys.summary(f),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/outgoing-payments/summary', {
          params: {
            query: {
              search: f.search || undefined,
              categoryId: f.categoryId,
              kind: f.kind,
              method: f.method,
              from: f.from,
              to: f.to,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** Money in and out of the period; empty `from`/`to` = the server's default (the lab month so far). */
export const cashFlowQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: outgoingKeys.cashFlow(from, to),
    queryFn: () =>
      unwrap(api.GET('/api/v1/ledger/cash-flow', { params: { query: { from: from || undefined, to: to || undefined } } })),
    placeholderData: keepPreviousData,
  });

/** Active expense categories, for the form (the refund category is the one with `isDoctor`). */
export const outgoingCategoriesQuery = queryOptions({
  queryKey: outgoingKeys.categories,
  queryFn: async () =>
    (await unwrap(api.GET('/api/v1/expense-categories', { params: { query: { active: true, page: 1, pageSize: 100 } } })))
      .items,
});

/** Every category, inactive included: a filter must find old expenses (SPEC §5.9, plan X8). */
export const outgoingFilterCategoriesQuery = queryOptions({
  queryKey: outgoingKeys.allCategories,
  queryFn: async () =>
    (await unwrap(api.GET('/api/v1/expense-categories', { params: { query: { page: 1, pageSize: 100 } } }))).items,
});

export const outgoingExportApi = {
  list: (p: Omit<OutgoingListParams, 'page'>) =>
    takeFile(
      api.GET('/api/v1/exports/outgoing-payments', {
        params: {
          query: {
            search: p.search || undefined,
            categoryId: p.categoryId,
            kind: p.kind,
            method: p.method,
            status: p.status,
            from: p.from,
            to: p.to,
          },
        },
        parseAs: 'blob',
      }),
      'outgoing-payments.csv',
    ),
  byCategory: (f: Pick<OutgoingFilter, 'from' | 'to'>) =>
    takeFile(
      api.GET('/api/v1/exports/expenses-by-category', {
        params: { query: { from: f.from, to: f.to } },
        parseAs: 'blob',
      }),
      'expenses-by-category.csv',
    ),
};

export const outgoingApi = {
  /** `key` is one UUID per attempt: a retry or a double click returns the same payment (ADR-0010). */
  create: (body: CreateOutgoing, key: string) =>
    unwrap(api.POST('/api/v1/outgoing-payments', { body, params: { header: { 'Idempotency-Key': key } } })),
  void: (id: number, rowVersion: number, reason: string) =>
    unwrap(api.POST('/api/v1/outgoing-payments/{id}/void', { params: { path: { id } }, body: { rowVersion, reason } })),
  chequeStatus: (
    id: number,
    body: { status: ChequeStatus; rowVersion: number; statusDate?: string; note?: string | null },
  ) => unwrap(api.PATCH('/api/v1/outgoing-cheques/{id}/status', { params: { path: { id } }, body })),
};
