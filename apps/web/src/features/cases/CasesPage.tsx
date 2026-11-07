import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { Money, Td, Th } from '@/components/ui/table';
import { doctorQuery } from '@/features/doctors/api';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { formatNumber, todayIn } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { useUrlState } from '@/lib/url-state';
import { CASE_STATUSES, caseCountsQuery, casesQuery } from './api';
import type { CaseListParams, CaseStatus } from './api';
import { CaseActionDialogs, CaseRowMenu, clickableRow, useRowOpen, ViewCaseButton } from './CaseActions';
import type { CaseAction } from './CaseActions';
import { DoctorPicker } from './pickers';
import { OverdueMarker, STATUS_STYLE, StatusBadge } from './status';

type Key = 'q' | 'status' | 'doctor' | 'overdue' | 'from' | 'to' | 'page';
type Filters = Record<Key, string>;
type Patch = Partial<Record<Key, string | undefined>>;

const KEYS: Key[] = ['q', 'status', 'doctor', 'overdue', 'from', 'to', 'page'];
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

/**
 * Every filter is kept in the URL (reload, back/forward and shared links keep the list), through
 * useUrlState so the controls answer at once and quick successive changes are never lost.
 */
function useCaseListParams() {
  const [f, setFilters] = useUrlState(parseFilters, serializeFilters);
  const status = CASE_STATUSES.includes(f.status as CaseStatus) ? (f.status as CaseStatus) : undefined;
  const doctorId = Number.parseInt(f.doctor, 10);
  const list: CaseListParams = {
    search: f.q,
    status,
    doctorId: Number.isSafeInteger(doctorId) && doctorId > 0 ? doctorId : undefined,
    overdue: f.overdue === '1' || undefined,
    from: isIsoDate(f.from) ? f.from : undefined,
    to: isIsoDate(f.to) ? f.to : undefined,
    page: Math.max(1, Number.parseInt(f.page || '1', 10) || 1),
  };
  // A new filter starts again on page 1.
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

/** «الحالات»: dense rows with a status colour bar (direction C), filters, search and pages. */
export function CasesPage() {
  const { t } = useTranslation();
  const currency = useCurrency();
  const { data: settings } = useQuery(settingsQuery);
  const today = todayIn(settings?.labProfile?.timeZone ?? 'UTC');
  const { list, from, to, update, clear } = useCaseListParams();
  const { data } = useQuery(casesQuery(list));
  // The chips count what the list would show for each status with the other filters applied.
  const countFilter = {
    search: list.search,
    doctorId: list.doctorId,
    overdue: list.overdue,
    from: list.from,
    to: list.to,
  };
  const { data: counts } = useQuery(caseCountsQuery(countFilter));
  const lang = currentLanguage();
  const openRow = useRowOpen();
  const [action, setAction] = useState<CaseAction>(null);
  const { data: doctor } = useQuery({
    ...doctorQuery(list.doctorId ?? 0),
    enabled: list.doctorId !== undefined,
  });
  const filtered =
    list.search !== '' || list.status || list.doctorId || list.overdue || from !== '' || to !== '';

  return (
    <>
      <PageHeader
        title={t('cases.title')}
        intro={t('cases.intro')}
        actions={
          <Button asChild>
            <Link to="/cases/new">
              <Plus aria-hidden="true" />
              {t('cases.newCase')}
            </Link>
          </Button>
        }
      />
      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBox value={list.search} onChange={(q) => update({ q })} label={t('cases.search')} />
          <DoctorPicker
            label={t('cases.doctorFilter')}
            emptyLabel={t('cases.allDoctors')}
            required={false}
            quickAdd={false}
            className="w-56"
            value={list.doctorId ? { id: list.doctorId, name: doctor?.name ?? '' } : null}
            onChange={(d) => update({ doctor: d ? String(d.id) : undefined })}
          />
          <DateField
            label={t('cases.from')}
            today={today}
            value={from}
            onChange={(v) => update({ from: v })}
            className="w-44"
          />
          <DateField
            label={t('cases.to')}
            today={today}
            value={to}
            onChange={(v) => update({ to: v })}
            className="w-44"
          />
          <label className="flex h-10 items-center gap-2 text-[14px] font-bold">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-blue)]"
              checked={list.overdue === true}
              onChange={(e) => update({ overdue: e.target.checked ? '1' : undefined })}
            />
            {t('cases.overdueOnly')}
            {counts && ' '}
            {counts && (
              <span className="num font-semibold text-muted">({formatNumber(counts.overdue, lang)})</span>
            )}
          </label>
          {filtered && (
            <Button variant="link" className="h-10" onClick={clear}>
              {t('cases.clearFilters')}
            </Button>
          )}
        </div>
        <div role="group" aria-label={t('cases.statusFilter')} className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!list.status}
            className={cn(
              chip,
              !list.status ? 'border-navy bg-navy text-white hover:bg-navy' : 'border-border',
            )}
            onClick={() => update({ status: undefined })}
          >
            {t('cases.allStatuses')}
            {counts && ' '}
            {counts && (
              <span className="num font-semibold opacity-80">{formatNumber(counts.total, lang)}</span>
            )}
          </button>
          {CASE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={list.status === s}
              className={cn(chip, list.status === s ? 'border-navy bg-info-bg' : 'border-border')}
              onClick={() => update({ status: s })}
            >
              <i aria-hidden="true" className={cn('size-2 rounded-full', STATUS_STYLE[s].dot)} />
              {t(`caseStatus.${s}`)}
              {counts && ' '}
              {counts && (
                <span className="num font-semibold text-muted">{formatNumber(counts.byStatus[s], lang)}</span>
              )}
            </button>
          ))}
        </div>
      </Card>
      <Card className="px-3 py-2">
        <DataTable
          caption={t('cases.title')}
          empty={(data?.items.length ?? 0) === 0}
          emptyText={filtered ? t('list.noResults') : t('cases.empty')}
          head={
            <>
              <Th kind="number">{t('cases.caseNo')}</Th>
              <Th>{t('cases.doctor')}</Th>
              <Th>{t('cases.patient')}</Th>
              <Th>{t('cases.technician')}</Th>
              <Th kind="number">{t('cases.received')}</Th>
              <Th kind="number">{t('cases.expected')}</Th>
              <Th>{t('cases.status')}</Th>
              <Th kind="money">{t('cases.total')}</Th>
              <Th kind="actions">
                <span className="sr-only">{t('list.actions')}</span>
              </Th>
            </>
          }
        >
          {data?.items.map((c) => (
            <tr key={c.id} className={clickableRow} onClick={openRow(c.id)}>
              <Td kind="number" className={cn('border-s-4 py-2!', STATUS_STYLE[c.status].bar)}>
                <Link
                  to={`/cases/${c.id}`}
                  className="num font-extrabold text-ink underline-offset-4 hover:underline"
                >
                  {c.caseNo}
                </Link>
              </Td>
              <Td autoDir className="py-2!">
                {c.doctor.name}
              </Td>
              <Td autoDir className="py-2!">
                {c.patientName}
              </Td>
              <Td autoDir className="py-2! text-muted">
                {c.technician?.name ?? '—'}
              </Td>
              <Td kind="number" className="py-2!">
                {c.receivedDate}
              </Td>
              <Td kind="number" className="py-2! whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span className="num">{c.expectedDate}</span>
                  {c.overdue && <OverdueMarker />}
                </span>
              </Td>
              <Td className="py-2!">
                <StatusBadge status={c.status} />
              </Td>
              <Td
                kind="money"
                className={cn('py-2! font-bold', c.status === 'cancelled' && 'text-muted line-through')}
              >
                <Money value={currency.format(c.total)} symbol={currency.symbol} />
              </Td>
              <Td kind="actions" className="py-1.5!">
                <ViewCaseButton id={c.id} caseNo={c.caseNo} />
                <CaseRowMenu id={c.id} caseNo={c.caseNo} onAction={setAction} />
              </Td>
            </tr>
          ))}
        </DataTable>
        {data && (
          <Pager
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(page) => update({ page: String(page) })}
          />
        )}
      </Card>
      <CaseActionDialogs action={action} onClose={() => setAction(null)} />
    </>
  );
}
