import { useQuery } from '@tanstack/react-query';
import { Ban, CircleCheck, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { ExportButton } from '@/components/ui/export-button';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { Td, Th } from '@/components/ui/table';
import { useCan } from '@/features/auth/permissions';
import { FilterSelect } from '@/features/payments/PaymentsPage';
import { MoneyCell } from '@/features/payments/parts';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { clickableRow } from '@/features/cases/CaseActions';
import { useUrlState } from '@/lib/url-state';
import { INVOICE_TYPE_LIST, invoiceExportApi, invoicesQuery } from './api';
import type { InvoiceListParams, InvoiceStatus, InvoiceType } from './api';

const badge = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold whitespace-nowrap [&_svg]:size-3.5';

/** «فعالة» / «ملغاة»: icon and word, never colour alone. */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation();
  return status === 'void' ? (
    <span className={cn(badge, 'bg-st-cancelled-bg text-st-cancelled-ink')}>
      <Ban aria-hidden="true" />
      {t('invoices.status.void')}
    </span>
  ) : (
    <span className={cn(badge, 'bg-st-ready-bg text-st-ready-ink')}>
      <CircleCheck aria-hidden="true" />
      {t('invoices.status.active')}
    </span>
  );
}

type Key = 'q' | 'type' | 'status' | 'from' | 'to' | 'page';
type Filters = Record<Key, string>;
const KEYS: Key[] = ['q', 'type', 'status', 'from', 'to', 'page'];
const parseFilters = (p: URLSearchParams): Filters => Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ''])) as Filters;
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

/**
 * «الفواتير» (SPEC §5.14): every invoice, statement and free invoice, newest first; search by number or party,
 * filters in the address, CSV. A voided one stays listed, struck through, with its reason.
 */
export function InvoicesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const [f, setFilters] = useUrlState(parseFilters, serializeFilters);
  const list: InvoiceListParams = {
    search: f.q,
    type: INVOICE_TYPE_LIST.includes(f.type as InvoiceType) ? (f.type as InvoiceType) : undefined,
    status: f.status === 'active' || f.status === 'void' ? f.status : undefined,
    from: isIsoDate(f.from) ? f.from : undefined,
    to: isIsoDate(f.to) ? f.to : undefined,
    page: Math.max(1, Number.parseInt(f.page || '1', 10) || 1),
  };
  const update = (patch: Partial<Filters>) =>
    setFilters((prev) => ({ ...prev, ...patch, ...('page' in patch ? {} : { page: '' }) }));
  const { data, isError, refetch } = useQuery({ ...invoicesQuery(list), throwOnError: false });
  const filtered = Boolean(list.search || list.type || list.status || f.from || f.to);
  const navigate = useNavigate();
  // A whole row opens the invoice (mouse convenience); keyboard users use the number link.
  const open = (e: MouseEvent<HTMLElement>, to: string) => {
    const target = e.target as Element;
    if (target.closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.toString()) return;
    void navigate(to);
  };

  return (
    <>
      <PageHeader
        title={t('invoices.list.title')}
        intro={t('invoices.list.intro')}
        actions={
          can('invoices.write') ? (
            <Button asChild>
              <Link to="/invoices/new">
                <Plus aria-hidden="true" />
                {t('invoices.list.new')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Card className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBox value={list.search} onChange={(q) => update({ q })} label={t('invoices.list.search')} />
        <FilterSelect
          label={t('invoices.list.typeFilter')}
          value={list.type ?? ''}
          onChange={(v) => update({ type: v })}
          options={[['', t('invoices.list.allTypes')], ...INVOICE_TYPE_LIST.map((k): [string, string] => [k, t(`invoices.types.${k}`)])]}
        />
        <FilterSelect
          label={t('invoices.list.statusFilter')}
          value={list.status ?? ''}
          onChange={(v) => update({ status: v })}
          options={[
            ['', t('invoices.list.allStatuses')],
            ['active', t('invoices.status.active')],
            ['void', t('invoices.status.void')],
          ]}
        />
        <DateField label={t('invoices.list.from')} today={today} value={f.from} onChange={(v) => update({ from: v })} className="w-44" />
        <DateField label={t('invoices.list.to')} today={today} value={f.to} onChange={(v) => update({ to: v })} className="w-44" />
        {filtered && (
          <Button variant="link" className="h-10" onClick={() => setFilters(() => parseFilters(new URLSearchParams()))}>
            {t('invoices.list.clearFilters')}
          </Button>
        )}
        <div className="ms-auto">
          <ExportButton
            needs={['invoices.read']}
            label={t('invoices.list.export')}
            run={() => invoiceExportApi.list(list)}
            disabledReason={data && data.total === 0 ? t('export.nothing') : null}
          />
        </div>
      </Card>
      <Card className="px-3 py-2">
        {isError && !data ? (
          <div role="alert" className="flex flex-col items-start gap-3 p-4">
            <p className="font-semibold text-danger">{t('invoices.list.loadError')}</p>
            <Button variant="secondary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : !data ? (
          <div className="p-4" role="status" aria-label={t('common.loading')}>
            <div className="h-6 w-full animate-pulse rounded bg-hover" />
          </div>
        ) : (
          <DataTable
            caption={t('invoices.list.title')}
            empty={data.items.length === 0}
            emptyText={filtered ? t('list.noResults') : t('invoices.list.empty')}
            head={
              <>
                <Th kind="number">{t('invoices.list.no')}</Th>
                <Th>{t('invoices.list.type')}</Th>
                <Th kind="number">{t('invoices.list.date')}</Th>
                <Th>{t('invoices.list.party')}</Th>
                <Th kind="money">{t('invoices.list.total')}</Th>
                <Th>{t('invoices.list.status')}</Th>
              </>
            }
          >
            {data.items.map((i) => (
              <tr
                key={i.id}
                data-invoice={i.no}
                className={cn(clickableRow, i.status === 'void' && 'text-muted')}
                onClick={(e) => open(e, `/invoices/${i.id}`)}
              >
                <Td kind="number" className={cn('font-extrabold', i.status === 'void' && 'line-through')}>
                  <Link to={`/invoices/${i.id}`} className="text-ink underline-offset-4 hover:underline">
                    {i.no}
                  </Link>
                </Td>
                <Td>{t(`invoices.types.${i.type}`)}</Td>
                <Td kind="number">{i.issueDate}</Td>
                <Td autoDir>{i.partyName}</Td>
                <Td kind="money" className={cn('font-bold', i.status === 'void' && 'line-through')}>
                  {i.total === null ? <span className="text-muted">—</span> : <MoneyCell minor={i.total} />}
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <InvoiceStatusBadge status={i.status} />
                    {i.status === 'void' && i.voidReason && (
                      <span dir="auto" className="text-[12.5px]">
                        {t('invoices.list.voidedReason', { reason: i.voidReason })}
                      </span>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page: String(page) })} />}
      </Card>
    </>
  );
}
