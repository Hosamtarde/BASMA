import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { ExportButton } from '@/components/ui/export-button';
import { Td, Th } from '@/components/ui/table';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { useUrlState } from '@/lib/url-state';
import { debtsQuery, exportApi } from './api';
import type { DebtDirection, DebtListParams } from './api';
import { DebtBreakdownDialog } from './DebtBreakdownDialog';
import { MoneyCell } from './parts';

type Key = 'q' | 'dir' | 'page' | 'doctor' | 'bp';
type Filters = Record<Key, string>;
const KEYS: Key[] = ['q', 'dir', 'page', 'doctor', 'bp'];
const parse = (p: URLSearchParams): Filters => Object.fromEntries(KEYS.map((k) => [k, p.get(k) ?? ''])) as Filters;
function serialize(f: Filters): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of KEYS) {
    const v = f[k].trim();
    if (v !== '' && !((k === 'page' || k === 'bp') && v === '1')) out.set(k, v);
  }
  return out;
}

const DIRECTIONS: DebtDirection[] = ['all', 'owed_to_lab', 'owed_by_lab'];
const chip =
  'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-bold whitespace-nowrap hover:bg-hover';

function SummaryCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card px-4 py-3">
      <p className="text-[13px] font-bold text-muted">{label}</p>
      <p className={cn('mt-1 text-[22px] leading-tight font-extrabold', tone)}>{value}</p>
    </div>
  );
}

/** «الديون» (SPEC §5.11): four figures and the doctors with a balance; a name opens the breakdown, with the statement one click away. */
export function DebtsPage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [f, setFilters] = useUrlState(parse, serialize);
  const list: DebtListParams = {
    search: f.q,
    direction: (DIRECTIONS as string[]).includes(f.dir) ? (f.dir as DebtDirection) : 'all',
    page: Math.max(1, Number.parseInt(f.page || '1', 10) || 1),
  };
  const { data } = useQuery(debtsQuery(list));
  const update = (patch: Partial<Filters>) =>
    setFilters((prev) => ({ ...prev, ...patch, ...('page' in patch || 'doctor' in patch || 'bp' in patch ? {} : { page: '' }) }));
  const openId = Number.parseInt(f.doctor, 10);
  const open = Number.isSafeInteger(openId) && openId > 0 ? openId : undefined;
  const openName = data?.items.find((d) => d.doctor.id === open)?.doctor.name ?? '';
  const bpage = Math.max(1, Number.parseInt(f.bp || '1', 10) || 1);
  const filtered = list.search !== '' || list.direction !== 'all';
  const label: Record<DebtDirection, string> = {
    all: t('debts.filterAll'),
    owed_to_lab: t('debts.filterToLab'),
    owed_by_lab: t('debts.filterByLab'),
  };

  return (
    <>
      <PageHeader title={t('debts.title')} />
      <p role="note" className="mb-4 rounded-lg bg-info-bg px-4 py-2.5 text-[14px] font-semibold text-ink">
        {t('debts.banner')}
      </p>
      <section aria-label={t('debts.title')} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label={t('debts.parties')}
          value={data ? <span className="num">{formatNumber(data.summary.parties, lang)}</span> : '—'}
        />
        <SummaryCard
          label={t('debts.owedToLab')}
          tone="text-warning-ink"
          value={data ? <MoneyCell minor={data.summary.owedToLab} /> : '—'}
        />
        <SummaryCard
          label={t('debts.owedByLab')}
          tone="text-cyan-ink"
          value={data ? <MoneyCell minor={data.summary.owedByLab} /> : '—'}
        />
        <SummaryCard label={t('debts.net')} value={data ? <MoneyCell minor={data.summary.net} /> : '—'} />
      </section>
      <Card className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBox value={list.search} onChange={(q) => update({ q })} label={t('debts.search')} />
        <div role="group" aria-label={t('debts.filterGroup')} className="flex flex-wrap gap-2">
          {DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={list.direction === d}
              className={cn(chip, list.direction === d ? 'border-navy bg-navy text-white hover:bg-navy' : 'border-border')}
              onClick={() => update({ dir: d === 'all' ? '' : d })}
            >
              {label[d]}
            </button>
          ))}
        </div>
        {filtered && (
          <Button variant="link" className="h-10" onClick={() => setFilters(() => parse(new URLSearchParams()))}>
            {t('debts.clearFilters')}
          </Button>
        )}
        <span className="flex-1" />
        <ExportButton
          needs={['ledger.read']}
          run={() => exportApi.debts(list)}
          disabledReason={data && data.total === 0 ? t('export.nothing') : null}
        />
      </Card>
      <Card className="px-3 py-2">
        <DataTable
          caption={t('debts.title')}
          empty={(data?.items.length ?? 0) === 0}
          emptyText={filtered ? t('debts.noResults') : t('debts.empty')}
          head={
            <>
              <Th>{t('debts.doctor')}</Th>
              <Th>{t('debts.direction')}</Th>
              <Th kind="money">{t('debts.amount')}</Th>
              <Th kind="money">{t('debts.pendingCheques')}</Th>
              <Th kind="actions">
                <span className="sr-only">{t('list.actions')}</span>
              </Th>
            </>
          }
        >
          {data?.items.map((d) => (
            <tr key={d.doctor.id} data-debt={d.doctor.id}>
              <Td autoDir className="font-bold">
                <button
                  type="button"
                  className="cursor-pointer text-start font-bold text-ink underline-offset-4 hover:underline"
                  aria-haspopup="dialog"
                  onClick={() => update({ doctor: String(d.doctor.id), bp: '' })}
                >
                  {d.doctor.name}
                </button>
              </Td>
              <Td>
                <span
                  className={cn(
                    'inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-bold whitespace-nowrap',
                    d.direction === 'owed_to_lab' ? 'bg-success-bg text-success-ink' : 'bg-warning-bg text-warning-ink',
                  )}
                >
                  {d.direction === 'owed_to_lab' ? t('debts.toLab') : t('debts.byLab')}
                </span>
              </Td>
              <Td kind="money" className="font-extrabold">
                <MoneyCell minor={Math.abs(d.balance)} />
              </Td>
              <Td kind="money" className="text-muted">
                {d.pendingCheques > 0 ? <MoneyCell minor={d.pendingCheques} /> : '—'}
              </Td>
              <Td kind="actions">
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/doctors/${d.doctor.id}/statement`} aria-label={t('debts.openStatement', { name: d.doctor.name })}>
                    {t('breakdown.statement')}
                  </Link>
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={(page) => update({ page: String(page) })} />}
      </Card>
      {open !== undefined && (
        <DebtBreakdownDialog
          key={open}
          doctor={{ id: open, name: openName }}
          page={bpage}
          onPage={(p) => update({ bp: String(p) })}
          onClose={() => update({ doctor: '', bp: '' })}
        />
      )}
    </>
  );
}
