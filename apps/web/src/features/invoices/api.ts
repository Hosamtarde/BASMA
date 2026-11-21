import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { InvoiceSnapshot, InvoiceTemplate } from '@app/shared';
import { api, unwrap } from '@/api/client';
import { takeFile } from '@/api/download';
import type { components, paths } from '@/api/schema.gen';
import { PAGE_SIZE } from '@/features/catalog/api';
import { refreshMoney } from '@/features/payments/api';

export type InvoiceListItem = components['schemas']['InvoiceListItemResponse'];
export type InvoiceResponse = components['schemas']['InvoiceResponse'];
export type InvoiceType = InvoiceListItem['type'];
export type InvoiceStatus = InvoiceListItem['status'];
export type CreateInvoice = components['schemas']['CreateInvoiceRequest'];
export type EligibleCase = components['schemas']['EligibleCaseResponse'];

/** The API returns the snapshot as an object; its shape is the shared contract (`InvoiceSnapshot`). */
export type Invoice = Omit<InvoiceResponse, 'snapshot'> & { snapshot: InvoiceSnapshot };
export const asInvoice = (r: InvoiceResponse): Invoice => r as unknown as Invoice;

export const INVOICE_TYPE_LIST: readonly InvoiceType[] = ['cases', 'statement', 'free'];

type ListQuery = NonNullable<paths['/api/v1/invoices']['get']['parameters']['query']>;

export interface InvoiceListParams {
  search: string;
  type?: InvoiceType | undefined;
  status?: InvoiceStatus | undefined;
  doctorId?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
}

/** One family: an invoice write refreshes the list, the summary, the eligible cases and the doctor's documents. */
export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: ['invoices', 'list'] as const,
  list: (p: InvoiceListParams) => ['invoices', 'list', p] as const,
  detail: (id: number) => ['invoices', 'detail', id] as const,
  logo: (id: number) => ['invoices', 'logo', id] as const,
  summary: ['invoices', 'summary'] as const,
  eligible: (doctorId: number) => ['invoices', 'eligible', doctorId] as const,
  template: ['settings', 'invoice-template'] as const,
};

export const invoicesQuery = (p: InvoiceListParams) =>
  queryOptions({
    queryKey: invoiceKeys.list(p),
    queryFn: () => {
      const query: ListQuery = {
        search: p.search || undefined,
        type: p.type,
        status: p.status,
        doctorId: p.doctorId,
        from: p.from,
        to: p.to,
        page: p.page,
        pageSize: PAGE_SIZE,
      };
      return unwrap(api.GET('/api/v1/invoices', { params: { query } }));
    },
    placeholderData: keepPreviousData,
  });

export const invoiceQuery = (id: number) =>
  queryOptions({
    queryKey: invoiceKeys.detail(id),
    queryFn: async () => asInvoice(await unwrap(api.GET('/api/v1/invoices/{id}', { params: { path: { id } } }))),
    // Issued content never changes; only the status can (void), which every write invalidates.
    staleTime: 60_000,
  });

export const invoiceSummaryQuery = queryOptions({
  queryKey: invoiceKeys.summary,
  queryFn: () => unwrap(api.GET('/api/v1/invoices/summary')),
});

export const eligibleCasesQuery = (doctorId: number) =>
  queryOptions({
    queryKey: invoiceKeys.eligible(doctorId),
    queryFn: () =>
      unwrap(api.GET('/api/v1/invoices/eligible-cases', { params: { query: { doctorId, page: 1, pageSize: 100 } } })),
  });

export const invoiceTemplateQuery = queryOptions({
  queryKey: invoiceKeys.template,
  queryFn: async () => {
    const r = await unwrap(api.GET('/api/v1/settings/invoice-template'));
    return { template: r.template, rowVersion: r.rowVersion };
  },
});

export const invoiceApi = {
  preview: async (body: CreateInvoice) =>
    (await unwrap(api.POST('/api/v1/invoices/preview', { body }))).snapshot as unknown as InvoiceSnapshot,
  /** `key` is one UUID per attempt: a retry or a double click returns the same invoice (ADR-0010). */
  create: async (body: CreateInvoice, key: string) =>
    asInvoice(await unwrap(api.POST('/api/v1/invoices', { body, params: { header: { 'Idempotency-Key': key } } }))),
  void: async (id: number, rowVersion: number, reason: string) =>
    asInvoice(await unwrap(api.POST('/api/v1/invoices/{id}/void', { params: { path: { id } }, body: { rowVersion, reason } }))),
  saveTemplate: async (rowVersion: number, template: InvoiceTemplate) => {
    const r = await unwrap(
      api.PUT('/api/v1/settings/invoice-template', {
        body: { rowVersion, template: template },
      }),
    );
    return { template: r.template, rowVersion: r.rowVersion };
  },
};

export const invoiceExportApi = {
  list: (p: Omit<InvoiceListParams, 'page'>) =>
    takeFile(
      api.GET('/api/v1/exports/invoices', {
        params: {
          query: { search: p.search || undefined, type: p.type, status: p.status, doctorId: p.doctorId, from: p.from, to: p.to },
        },
        parseAs: 'blob',
      }),
      'invoices.csv',
    ),
};

/** After an invoice write: invoices, cases (their «مفوترة» lock), Home and the money views. */
export async function refreshInvoices(queryClient: QueryClient): Promise<void> {
  await Promise.all([queryClient.invalidateQueries({ queryKey: invoiceKeys.all }), refreshMoney(queryClient)]);
}

/**
 * The logo frozen into one invoice, as an object URL (fetched with the token, never `<img src="/api/…">`);
 * revoked when it changes or the screen closes. null while loading or when the invoice has none.
 */
export function useInvoiceLogoUrl(invoiceId: number, hasLogo: boolean): string | null {
  const { data: blob } = useQuery({
    queryKey: invoiceKeys.logo(invoiceId),
    queryFn: async () => {
      const { data, response } = await api.GET('/api/v1/invoices/{id}/logo', {
        params: { path: { id: invoiceId } },
        parseAs: 'blob',
      });
      return response.ok && data instanceof Blob ? data : null;
    },
    enabled: hasLogo,
    staleTime: Infinity,
    throwOnError: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}
