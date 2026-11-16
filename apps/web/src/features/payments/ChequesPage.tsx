import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActionButton } from '@/components/ui/action-button';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { settingsQuery } from '@/features/shell/settings';
import { formatNumber, todayIn } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { useUrlState } from '@/lib/url-state';
import { CHEQUE_STATUSES, chequesQuery, chequeSummaryQuery } from './api';
import type { ChequeListParams, ChequeStatus, Payment } from './api';
import { ChequeStatusDialog } from './PaymentDialogs';
import { ChequeStatusBadge, DueMarker, MoneyCell } from './parts';
import { FilterSelect } from './PaymentsPage';

type Key = 'q' | 'status' | 'due' | 'from' | 'to' | 'page';
type Filters = Record<Key, string>;
type Patch = Partial<Record<Key, string | undefined>>;
const KEYS: Key[] = ['q', 'status', 'due', 'from', 'to', 'page'];
const parseFilters = (p: URLSearchParams): Filters =>
  Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ''])) as Filters;

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

function useChequeListParams() {
  const [f, setFilters] = useUrlState(parseFilters, serializeFilters);
  const list: ChequeListParams = {
    search: f.q,
    status: CHEQUE_STATUSES.includes(f.status as ChequeStatus) ? (f.status as ChequeStatus) : undefined,
    due: f.due === 'soon' || f.due === 'overdue' ? f.due : undefined,
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

const chip =
  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold whitespace-nowrap hover:bg-hover';

/** «سجل الشيكات» (SPEC §5.13): incoming cheques with status chips, due markers and status changes. */
export function ChequesPage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const { list, from, to, update, clear } = useChequeListParams();
  const { data } = useQuery(chequesQuery(list));
  const { data: counts } = useQuery(
    chequeSummaryQuery({ search: list.search, due: list.due, from: list.from, to: list.to }),
  );
  const [changing, setChanging] = useState<Payment | null>(null);
  const filtered = list.search !== '' || list.status || list.due || from !== '' || to !== '';
  const count = (n: number | undefined) =>
    counts && n !== undefined ? (
      <>
        {' '}
        <span className="num font-semibold text-muted">{formatNumber(n, lang)}</span>
      </>
    ) : null;

  return (
    <>
      <PageHeader title={t('cheques.title')} intro={t('cheques.intro')} />
      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBox value={list.search} onChange={(q) => update({ q })} label={t('cheques.search')} />
          <FilterSelect
            label={t('cheques.dueGroup')}
            value={list.due ?? ''}
            onChange={(v) => update({ due: v || undefined })}
            options={[
              ['', t('cheques.dueAny')],
              ['soon', t('cheques.dueSoon')],
              ['overdue', t('cheques.dueOverdue')],
            ]}
          />
          <DateField label={t('cheques.from')} today={today} value={from} onChange={(v) => update({ from: v })} className="w-44" />
          <DateField label={t('cheques.to')} today={today} value={to} onChange={(v) => update({ to: v })} className="w-44" />
          {filtered && (
            <Button variant="link" className="h-10" onClick={clear}>
              {t('cheques.clearFilters')}
            </Button>
          )}
        </div>
        <div role="group" aria-label={t('cheques.statusGroup')} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={!list.status}
            className={cn(chip, !list.status ? 'border-navy bg-navy text-white hover:bg-navy' : 'border-border')}
            onClick={() => update({ status: undefined })}
          >
            {t('cheques.all')}
            {count(counts ? counts.byStatus.pending + counts.byStatus.cleared + counts.byStatus.returned : undefined)}
          </button>
          {CHEQUE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={list.status === s}
              className={cn(chip, list.status === s ? 'border-navy bg-info-bg' : 'border-border')}
              onClick={() => update({ status: s })}
            >
              {t(`cheques.${s}`)}
              {count(counts?.byStatus[s])}
            </button>
          ))}
          {counts && (
            <span className="ms-auto text-[13.5px] text-muted" data-testid="cheque-pending-amount">
              {t('cheques.summary', { amount: '' })}
              <b className="text-ink">
                <MoneyCell minor={counts.pendingAmount} />
              </b>
            </span>
          )}
        </div>
      </Card>
      <Card className="px-3 py-2">
        <DataTable
          caption={t('cheques.title')}
          empty={(data?.items.length ?? 0) === 0}
          emptyText={filtered ? t('cheques.noResults') : t('cheques.empty')}
          head={
            <>
              <Th kind="number">{t('cheques.chequeNo')}</Th>
              <Th>{t('cheques.bank')}</Th>
              <Th>{t('cheques.doctor')}</Th>
              <Th kind="money">{t('cheques.amount')}</Th>
              <Th kind="number">{t('cheques.due')}</Th>
              <Th>{t('cheques.status')}</Th>
              <Th kind="number">{t('cheques.payment')}</Th>
              <Th kind="actions">
                <span className="sr-only">{t('list.actions')}</span>
              </Th>
            </>
          }
        >
          {data?.items.map((p) =>
            p.cheque ? (
              <tr
                key={p.id}
                data-cheque={p.cheque.chequeNo}
                data-due={p.cheque.dueState}
                className={cn(
                  p.cheque.dueState === 'overdue' && 'bg-danger-bg/40',
                  p.cheque.dueState === 'soon' && 'bg-warning-bg/50',
                )}
              >
                <Td kind="number" className="font-extrabold">
                  {p.cheque.chequeNo}
                </Td>
                <Td autoDir>{p.cheque.bank}</Td>
                <Td autoDir>
                  <Link to={`/doctors/${p.doctor.id}`} className="text-ink underline-offset-4 hover:underline">
                    {p.doctor.name}
                  </Link>
                </Td>
                <Td kind="money" className="font-bold">
                  <MoneyCell minor={p.amount} />
                </Td>
                <Td kind="number">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="num">{p.cheque.dueDate}</span>
                    <DueMarker cheque={p.cheque} />
                  </span>
                </Td>
                <Td>
                  <ChequeStatusBadge status={p.cheque.status} />
                </Td>
                <Td kind="number">{p.voucherNo}</Td>
                <Td kind="actions">
                  <ActionButton
                    variant="secondary"
                    size="sm"
                    aria-label={`${t('cheques.changeStatus')} ${p.cheque.chequeNo}`}
                    disabledReason={p.cheque.allowedStatuses.length === 0 ? t('cheques.noChange') : null}
                    onClick={() => setChanging(p)}
                  >
                    {t('cheques.changeStatus')}
                  </ActionButton>
                </Td>
              </tr>
            ) : null,
          )}
        </DataTable>
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page: String(page) })} />}
      </Card>
      {changing && (
        <ChequeStatusDialog
          key={`${changing.id}:${changing.cheque?.rowVersion ?? 0}`}
          payment={data?.items.find((p) => p.id === changing.id) ?? changing}
          open
          onOpenChange={(o) => !o && setChanging(null)}
        />
      )}
    </>
  );
}
