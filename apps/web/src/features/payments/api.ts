import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { takeFile } from '@/api/download';
import type { components, paths } from '@/api/schema.gen';
import { catalogKeys, PAGE_SIZE } from '@/features/catalog/api';
import { outgoingKeys } from '@/features/outgoing/api';

export type Payment = components['schemas']['PaymentResponse'];
export type PaymentResult = components['schemas']['PaymentResultResponse'];
export type Cheque = components['schemas']['ChequeResponse'];
export type CreatePayment = components['schemas']['CreatePaymentRequest'];
export type PaymentMethod = Payment['method'];
export type PaymentStatus = Payment['status'];
export type ChequeStatus = Cheque['status'];
export type DoctorBalance = components['schemas']['DoctorBalanceResponse'];
export type DebtBreakdown = components['schemas']['DebtBreakdownResponse'];
export type ReceiptsSummary = components['schemas']['PaymentSummaryResponse'];
export type DebtDirection = 'owed_to_lab' | 'owed_by_lab' | 'all';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'cheque', 'transfer'];
export const CHEQUE_STATUSES: readonly ChequeStatus[] = ['pending', 'cleared', 'returned'];

type PaymentQuery = NonNullable<paths['/api/v1/payments']['get']['parameters']['query']>;

/** The filters of the payments list (the address keeps them; see PaymentsPage). */
export interface PaymentListParams {
  search: string;
  doctorId?: number | undefined;
  method?: PaymentMethod | undefined;
  status?: PaymentStatus | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
}

export type ChequeDirection = 'in' | 'out';
export type ChequeRegisterItem = components['schemas']['ChequeRegisterItem'];
export type ChequeRegisterSummary = components['schemas']['ChequeRegisterSummaryResponse'];

/** The filters of the cheque register (two directions, SPEC §5.13). */
export interface ChequeListParams {
  search: string;
  direction?: ChequeDirection | undefined;
  status?: ChequeStatus | undefined;
  due?: 'soon' | 'overdue' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
}
export type ChequeCountFilter = Omit<ChequeListParams, 'status' | 'direction' | 'page'>;

export interface DebtListParams {
  search: string;
  direction: DebtDirection;
  page: number;
}

export const paymentKeys = {
  all: ['payments'] as const,
  lists: ['payments', 'list'] as const,
  list: (p: PaymentListParams) => ['payments', 'list', p] as const,
  forCase: (caseId: number) => ['payments', 'case', caseId] as const,
  cheques: ['payments', 'cheques'] as const,
  chequeList: (p: ChequeListParams) => ['payments', 'cheques', 'list', p] as const,
  chequeSummary: (f: ChequeCountFilter) => ['payments', 'cheques', 'summary', f] as const,
  balance: (doctorId: number) => ['payments', 'balance', doctorId] as const,
  statement: (doctorId: number, from: string, to: string, page: number) =>
    ['payments', 'statement', doctorId, from, to, page] as const,
  debts: ['payments', 'debts'] as const,
  debtList: (p: DebtListParams) => ['payments', 'debts', p] as const,
  summary: ['payments', 'summary'] as const,
  breakdown: (doctorId: number, page: number) => ['payments', 'breakdown', doctorId, page] as const,
  receipts: (p: ReceiptsParams) => ['payments', 'receipts', p] as const,
};

/** Open cases per page in the breakdown dialog. */
export const BREAKDOWN_PAGE_SIZE = 10;

/** The receipts summary uses the payments list filters except status and paging. */
export type ReceiptsParams = Omit<PaymentListParams, 'status' | 'page'>;

export const paymentsQuery = (p: PaymentListParams) =>
  queryOptions({
    queryKey: paymentKeys.list(p),
    queryFn: () => {
      const query: PaymentQuery = {
        search: p.search || undefined,
        doctorId: p.doctorId,
        method: p.method,
        status: p.status,
        from: p.from,
        to: p.to,
        page: p.page,
        pageSize: PAGE_SIZE,
      };
      return unwrap(api.GET('/api/v1/payments', { params: { query } }));
    },
    placeholderData: keepPreviousData,
  });

/** Payments bound to a case with its paid / remaining amounts (SPEC §5.6). */
export const casePaymentsQuery = (caseId: number) =>
  queryOptions({
    queryKey: paymentKeys.forCase(caseId),
    queryFn: () => unwrap(api.GET('/api/v1/cases/{id}/payments', { params: { path: { id: caseId } } })),
  });

/** The register: incoming and outgoing cheques by due date (the B3 `GET /cheques` stays incoming-only). */
export const chequesQuery = (p: ChequeListParams) =>
  queryOptions({
    queryKey: paymentKeys.chequeList(p),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/cheques/register', {
          params: {
            query: {
              search: p.search || undefined,
              direction: p.direction,
              status: p.status,
              due: p.due,
              dueFrom: p.from,
              dueTo: p.to,
              page: p.page,
              pageSize: PAGE_SIZE,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** Chip counts (status, direction, due) under the same filters, without status and direction. */
export const chequeSummaryQuery = (f: ChequeCountFilter) =>
  queryOptions({
    queryKey: paymentKeys.chequeSummary(f),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/cheques/register/summary', {
          params: { query: { search: f.search || undefined, due: f.due, dueFrom: f.from, dueTo: f.to } },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const doctorBalanceQuery = (doctorId: number) =>
  queryOptions({
    queryKey: paymentKeys.balance(doctorId),
    queryFn: () => unwrap(api.GET('/api/v1/doctors/{id}/balance', { params: { path: { id: doctorId } } })),
  });

export const statementQuery = (doctorId: number, from: string, to: string, page: number) =>
  queryOptions({
    queryKey: paymentKeys.statement(doctorId, from, to, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/doctors/{id}/statement', {
          params: {
            path: { id: doctorId },
            query: { from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

export const debtsQuery = (p: DebtListParams) =>
  queryOptions({
    queryKey: paymentKeys.debtList(p),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/debts', {
          params: {
            query: { search: p.search || undefined, direction: p.direction, page: p.page, pageSize: PAGE_SIZE },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** What makes up a doctor's balance (SPEC §5.11); ties out to `doctorBalanceQuery`. */
export const debtBreakdownQuery = (doctorId: number, page: number) =>
  queryOptions({
    queryKey: paymentKeys.breakdown(doctorId, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/doctors/{id}/debt-breakdown', {
          params: { path: { id: doctorId }, query: { page, pageSize: BREAKDOWN_PAGE_SIZE } },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** «تقرير المقبوضات» figures: counted by method on the collection date, memo lines apart. */
export const receiptsSummaryQuery = (p: ReceiptsParams) =>
  queryOptions({
    queryKey: paymentKeys.receipts(p),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/payments/summary', {
          params: {
            query: {
              search: p.search || undefined,
              doctorId: p.doctorId,
              method: p.method,
              from: p.from,
              to: p.to,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** CSV files: built by the API from the same filters as the screen (see ExportButton). */
export const exportApi = {
  debts: (p: Pick<DebtListParams, 'search' | 'direction'>) =>
    takeFile(
      api.GET('/api/v1/exports/debts', {
        params: { query: { search: p.search || undefined, direction: p.direction } },
        parseAs: 'blob',
      }),
      'debts.csv',
    ),
  breakdown: (doctorId: number) =>
    takeFile(
      api.GET('/api/v1/exports/doctors/{id}/debt-breakdown', {
        params: { path: { id: doctorId } },
        parseAs: 'blob',
      }),
      'debt-breakdown.csv',
    ),
  statement: (doctorId: number, from: string, to: string) =>
    takeFile(
      api.GET('/api/v1/exports/doctors/{id}/statement', {
        params: { path: { id: doctorId }, query: { from: from || undefined, to: to || undefined } },
        parseAs: 'blob',
      }),
      'statement.csv',
    ),
  payments: (p: Omit<PaymentListParams, 'page'>) =>
    takeFile(
      api.GET('/api/v1/exports/payments', {
        params: {
          query: {
            search: p.search || undefined,
            doctorId: p.doctorId,
            method: p.method,
            status: p.status,
            from: p.from,
            to: p.to,
          },
        },
        parseAs: 'blob',
      }),
      'payments.csv',
    ),
};

export const ledgerSummaryQuery = queryOptions({
  queryKey: paymentKeys.summary,
  queryFn: () => unwrap(api.GET('/api/v1/ledger/summary')),
});

export const paymentApi = {
  /** `key` is one UUID per attempt: a retry or a double click returns the same payment (ADR-0010). */
  create: (body: CreatePayment, key: string) =>
    unwrap(api.POST('/api/v1/payments', { body, params: { header: { 'Idempotency-Key': key } } })),
  void: (id: number, rowVersion: number, reason: string) =>
    unwrap(api.POST('/api/v1/payments/{id}/void', { params: { path: { id } }, body: { rowVersion, reason } })),
  chequeStatus: (
    id: number,
    body: { status: ChequeStatus; rowVersion: number; statusDate?: string; note?: string | null },
  ) => unwrap(api.PATCH('/api/v1/cheques/{id}/status', { params: { path: { id } }, body })),
};

/**
 * After any money write: payments, cheques, debts, balances and statements, the Home summary,
 * the cases (paid / remaining) and the settings (amounts lock the currency, SPEC §5.18).
 */
export async function refreshMoney(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: paymentKeys.all }),
    // Outgoing list, summaries and cash flow; the category picker of the form; refundable credit.
    queryClient.invalidateQueries({ queryKey: outgoingKeys.all }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.expenseCategories }),
    queryClient.invalidateQueries({ queryKey: ['cases'] }),
    queryClient.invalidateQueries({ queryKey: ['settings'] }),
    // Cheques due and what is still owed feed the bell (B5).
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  ]);
}

/** A new idempotency key for one form attempt. */
export const newIdempotencyKey = (): string => globalThis.crypto.randomUUID();
