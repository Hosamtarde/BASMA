import { useQuery } from '@tanstack/react-query';
import { Ban, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { ExportButton } from '@/components/ui/export-button';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { ChequeStatusDialog, VoidPaymentDialog } from '@/features/payments/PaymentDialogs';
import { FilterSelect } from '@/features/payments/PaymentsPage';
import { MoneyCell, PaymentStatusBadge } from '@/features/payments/parts';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { useUrlState } from '@/lib/url-state';
import {
  OUTGOING_KINDS,
  OUTGOING_METHODS,
  outgoingExportApi,
  outgoingFilterCategoriesQuery,
  outgoingQuery,
} from './api';
import { VoucherLink } from '@/features/vouchers/VoucherLink';
import type { OutgoingKind, OutgoingListParams, OutgoingMethod, OutgoingPayment } from './api';
import { CashFlowPanel } from './CashFlowPanel';
import { ExpensesSummary } from './ExpensesSummary';
import { OutgoingForm } from './OutgoingForm';

type Key = 'q' | 'category' | 'kind' | 'method' | 'status' | 'from' | 'to' | 'page';
type Filters = Record<Key, string>;
type Patch = Partial<Record<Key, string | undefined>>;
const KEYS: Key[] = ['q', 'category', 'kind', 'method', 'status', 'from', 'to', 'page'];
const parseFilters = (p: URLSearchParams): Filters =>
  Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ''])) as Filters;

/** Only complete values reach the address: a half-typed date stays in the box. */
function serializeFilters(f: Filters): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of KEYS) {
    const v = f[k].trim();
    if (v === '' || (k === 'page' && v === '1')) continue;
    if ((k === 'from' || k === 'to') && !isIsoDate(v)) continue;
    out.set(k, v);
  }
  return out;
}

/** The report filters live in the URL (useUrlState), like the receipts report. */
export function useOutgoingListParams() {
  const [f, setFilters] = useUrlState(parseFilters, serializeFilters);
  const categoryId = Number.parseInt(f.category, 10);
  const list: OutgoingListParams = {
    search: f.q,
    categoryId: Number.isSafeInteger(categoryId) && categoryId > 0 ? categoryId : undefined,
    kind: OUTGOING_KINDS.includes(f.kind as OutgoingKind) ? (f.kind as OutgoingKind) : undefined,
    method: OUTGOING_METHODS.includes(f.method as OutgoingMethod) ? (f.method as OutgoingMethod) : undefined,
    status: f.status === 'active' || f.status === 'void' ? f.status : undefined,
    from: isIsoDate(f.from) ? f.from : undefined,
    to: isIsoDate(f.to) ? f.to : undefined,
    page: Math.max(1, Number.parseInt(f.page || '1', 10) || 1),
  };
  const update = (patch: Patch) =>
    setFilters((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch) as [Key, string | undefined][]) next[k] = v ?? '';
      if (!('page' in patch)) next.page = '';
      return next;
    });
  const clear = () => setFilters(() => parseFilters(new URLSearchParams()));
  return { list, from: f.from, to: f.to, update, clear };
}

/** Method and, for a cheque, its number and the lab's bank. */
function MethodCell({ payment }: { payment: OutgoingPayment }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <span>{t(`payments.methods.${payment.method}`)}</span>
      {payment.cheque && (
        <span className="text-[12.5px] text-muted">
          <span dir="auto">{t('payments.chequeInfo', { no: payment.cheque.chequeNo, bank: payment.cheque.bank })}</span>
          {' · '}
          <span className="num">{payment.cheque.dueDate}</span>
        </span>
      )}
    </div>
  );
}

/**
 * «إنشاء دفعة صادرة» (SPEC §5.9): the form on top, «تقرير المصاريف» below with filters, totals per
 * category, the cash summary, two CSV files, voiding and the status of the lab's own cheques.
 */
export function OutgoingPage() {
  const { t } = useTranslation();
  const can = useCan();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const { list, from, to, update, clear } = useOutgoingListParams();
  const { data, isError, refetch } = useQuery({ ...outgoingQuery(list), throwOnError: false });
  const { data: categories } = useQuery(outgoingFilterCategoriesQuery);
  const [voiding, setVoiding] = useState<OutgoingPayment | null>(null);
  const [changing, setChanging] = useState<OutgoingPayment | null>(null);
  const filtered = list.search !== '' || list.categoryId || list.kind || list.method || list.status || from !== '' || to !== '';
  const filter = { search: list.search, categoryId: list.categoryId, kind: list.kind, method: list.method, from: list.from, to: list.to };

  return (
    <>
      <PageHeader title={t('outgoing.title')} intro={t('outgoing.intro')} />
      {can('expenses.write') && (
        <Card className="mb-5">
          <h2 className="mb-4 text-[17px] font-extrabold">{t('outgoing.newTitle')}</h2>
          <OutgoingForm />
        </Card>
      )}

      <h2 className="mb-2 text-[17px] font-extrabold">{t('outgoing.reportTitle')}</h2>
      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBox value={list.search} onChange={(q) => update({ q })} label={t('outgoing.search')} />
          <FilterSelect
            label={t('outgoing.categoryFilter')}
            value={list.categoryId ? String(list.categoryId) : ''}
            onChange={(v) => update({ category: v || undefined })}
            options={[
              ['', t('outgoing.allCategories')],
              ...(categories ?? []).map((c): [string, string] => [String(c.id), c.active ? c.name : `${c.name} (${t('outgoing.inactiveCategory')})`]),
            ]}
          />
          <FilterSelect
            label={t('outgoing.kindFilter')}
            value={list.kind ?? ''}
            onChange={(v) => update({ kind: v || undefined })}
            options={[
              ['', t('outgoing.allKinds')],
              ...OUTGOING_KINDS.map((k): [string, string] => [k, t(`outgoing.kinds.${k}`)]),
            ]}
          />
          <FilterSelect
            label={t('payments.methodFilter')}
            value={list.method ?? ''}
            onChange={(v) => update({ method: v || undefined })}
            options={[
              ['', t('payments.allMethods')],
              ...OUTGOING_METHODS.map((m): [string, string] => [m, t(`payments.methods.${m}`)]),
            ]}
          />
          <FilterSelect
            label={t('payments.statusFilter')}
            value={list.status ?? ''}
            onChange={(v) => update({ status: v || undefined })}
            options={[
              ['', t('payments.allStatuses')],
              ['active', t('payments.statusActive')],
              ['void', t('payments.statusVoid')],
            ]}
          />
          <DateField label={t('payments.from')} today={today} value={from} onChange={(v) => update({ from: v })} className="w-44" />
          <DateField label={t('payments.to')} today={today} value={to} onChange={(v) => update({ to: v })} className="w-44" />
          {filtered && (
            <Button variant="link" className="h-10" onClick={clear}>
              {t('payments.clearFilters')}
            </Button>
          )}
          <div className="ms-auto flex flex-wrap gap-2">
            <ExportButton
              needs={['expenses.read']}
              label={t('outgoing.exportList')}
              run={() => outgoingExportApi.list(list)}
              disabledReason={data && data.total === 0 ? t('export.nothing') : null}
            />
            <ExportButton
              needs={['expenses.read']}
              label={t('outgoing.exportByCategory')}
              run={() => outgoingExportApi.byCategory({ from: list.from, to: list.to })}
            />
          </div>
        </div>
        {data && (
          <p className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]" data-testid="outgoing-totals">
            <span>
              <span className="text-muted">{t('outgoing.totalCounted')}: </span>
              <b>
                <MoneyCell minor={data.totals.counted} />
              </b>
            </span>
            <span>
              <span className="text-muted">{t('outgoing.totalPending')}: </span>
              <b>
                <MoneyCell minor={data.totals.pendingCheques} />
              </b>
            </span>
          </p>
        )}
      </Card>
      <ExpensesSummary filter={filter} />
      <CashFlowPanel from={from} to={to} />
      <Card className="px-3 py-2">
        {isError && !data ? (
          <div role="alert" className="flex flex-col items-start gap-3 p-4">
            <p className="font-semibold text-danger">{t('outgoing.loadError')}</p>
            <Button variant="secondary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : !data ? (
          <div className="p-4" role="status" aria-label={t('common.loading')}>
            <div className="h-6 w-full animate-pulse rounded bg-hover" />
            <div className="mt-2 h-6 w-3/4 animate-pulse rounded bg-hover" />
          </div>
        ) : (
          <DataTable
            caption={t('outgoing.reportTitle')}
            empty={data.items.length === 0}
            emptyText={filtered ? t('list.noResults') : t('outgoing.empty')}
            head={
              <>
                <Th kind="number">{t('payments.voucher')}</Th>
                <Th kind="number">{t('payments.date')}</Th>
                <Th>{t('outgoing.category')}</Th>
                <Th>{t('outgoing.party')}</Th>
                <Th>{t('payments.method')}</Th>
                <Th kind="money">{t('payments.amount')}</Th>
                <Th>{t('payments.status')}</Th>
                <Th kind="actions">
                  <span className="sr-only">{t('list.actions')}</span>
                </Th>
              </>
            }
          >
            {data.items.map((p) => (
              <tr key={p.id} data-outgoing={p.voucherNo} className={cn(p.status === 'void' && 'text-muted')}>
                <Td kind="number" className={cn('font-extrabold', p.status === 'void' && 'line-through')}>
                  {p.voucherNo}
                </Td>
                <Td kind="number">{p.paidAt}</Td>
                <Td autoDir>{p.category.name}</Td>
                <Td autoDir>
                  {p.doctor ? (
                    <Link to={`/doctors/${p.doctor.id}`} className="text-ink underline-offset-4 hover:underline">
                      {p.doctor.name}
                    </Link>
                  ) : (
                    p.payee
                  )}
                </Td>
                <Td>
                  <MethodCell payment={p} />
                </Td>
                <Td kind="money" className={cn('font-bold', p.status === 'void' && 'line-through')}>
                  <MoneyCell minor={p.amount} />
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <PaymentStatusBadge payment={p} />
                    {p.status === 'active' && !p.counted && (
                      <span className="text-[12.5px] text-muted">{t('outgoing.countedNo')}</span>
                    )}
                    {p.status === 'void' && p.voidReason && (
                      <span dir="auto" className="text-[12.5px]">
                        {t('payments.voidedReason', { reason: p.voidReason })}
                      </span>
                    )}
                  </div>
                </Td>
                <Td kind="actions">
                  <div className="flex flex-wrap justify-end gap-1">
                    <VoucherLink to={`/outgoing/${p.id}/voucher`} voucherNo={p.voucherNo} />
                    {p.cheque && p.status === 'active' && can('cheques.write') && can('expenses.write') && (
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        aria-label={`${t('cheques.changeStatus')} ${p.cheque.chequeNo}`}
                        disabledReason={p.cheque.allowedStatuses.length === 0 ? t('cheques.noChange') : null}
                        onClick={() => setChanging(p)}
                      >
                        <RefreshCw aria-hidden="true" />
                        {t('cheques.changeStatus')}
                      </ActionButton>
                    )}
                    {can('expenses.void') && (
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        aria-label={`${t('payments.void')} ${p.voucherNo}`}
                        disabledReason={p.status === 'void' ? t('payments.voidWhy') : null}
                        onClick={() => setVoiding(p)}
                      >
                        <Ban aria-hidden="true" />
                      </ActionButton>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page: String(page) })} />}
      </Card>
      {voiding && (
        <VoidPaymentDialog
          key={voiding.id}
          direction="out"
          payment={data?.items.find((p) => p.id === voiding.id) ?? voiding}
          open
          onOpenChange={(o) => !o && setVoiding(null)}
        />
      )}
      {changing?.cheque && (
        <ChequeStatusDialog
          key={`${changing.id}:${changing.cheque.rowVersion}`}
          direction="out"
          cheque={data?.items.find((p) => p.id === changing.id)?.cheque ?? changing.cheque}
          open
          onOpenChange={(o) => !o && setChanging(null)}
        />
      )}
    </>
  );
}
