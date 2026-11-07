import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Card, DataTable, PageHeader, Pager, SearchBox } from '@/components/ui/list';
import { doctorQuery } from '@/features/doctors/api';
import { useCurrency } from '@/features/shell/currency';
import { settingsQuery } from '@/features/shell/settings';
import { todayIn } from '@/i18n/format';
import { cn } from '@/lib/cn';
import { isIsoDate } from '@/lib/dates';
import { CASE_STATUSES, casesQuery } from './api';
import type { CaseListParams, CaseStatus } from './api';
import { DoctorPicker } from './pickers';
import { OverdueMarker, STATUS_STYLE, StatusBadge } from './status';

type Patch = Partial<Record<'q' | 'status' | 'doctor' | 'overdue' | 'from' | 'to' | 'page', string | undefined>>;

/** Every filter lives in the URL, so reload, back/forward and shared links keep the list. */
function useCaseListParams() {
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status = CASE_STATUSES.includes(rawStatus as CaseStatus) ? (rawStatus as CaseStatus) : undefined;
  const doctorId = Number.parseInt(params.get('doctor') ?? '', 10);
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const list: CaseListParams = {
    search: params.get('q') ?? '',
    status,
    doctorId: Number.isSafeInteger(doctorId) && doctorId > 0 ? doctorId : undefined,
    overdue: params.get('overdue') === '1' || undefined,
    from: isIsoDate(from) ? from : undefined,
    to: isIsoDate(to) ? to : undefined,
    page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
  };
  const update = (patch: Patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '' || (k === 'page' && v === '1')) next.delete(k);
          else next.set(k, v);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  return { list, from, to, update, clear: () => setParams(new URLSearchParams(), { replace: true }) };
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
  const { data: doctor } = useQuery({ ...doctorQuery(list.doctorId ?? 0), enabled: list.doctorId !== undefined });
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
          <DateField label={t('cases.to')} today={today} value={to} onChange={(v) => update({ to: v })} className="w-44" />
          <label className="flex h-10 items-center gap-2 text-[14px] font-bold">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-blue)]"
              checked={list.overdue === true}
              onChange={(e) => update({ overdue: e.target.checked ? '1' : undefined })}
            />
            {t('cases.overdueOnly')}
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
            className={cn(chip, !list.status ? 'border-navy bg-navy text-white hover:bg-navy' : 'border-border')}
            onClick={() => update({ status: undefined })}
          >
            {t('cases.allStatuses')}
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
              <th scope="col">{t('cases.caseNo')}</th>
              <th scope="col">{t('cases.doctor')}</th>
              <th scope="col">{t('cases.patient')}</th>
              <th scope="col">{t('cases.technician')}</th>
              <th scope="col">{t('cases.received')}</th>
              <th scope="col">{t('cases.expected')}</th>
              <th scope="col">{t('cases.status')}</th>
              <th scope="col" className="text-end!">
                {t('cases.total')}
              </th>
            </>
          }
        >
          {data?.items.map((c) => (
            <tr key={c.id}>
              <td className={cn('border-s-4 py-2!', STATUS_STYLE[c.status].bar)}>
                <Link
                  to={`/cases/${c.id}`}
                  className="num font-extrabold text-ink underline-offset-4 hover:underline"
                >
                  {c.caseNo}
                </Link>
              </td>
              <td dir="auto" className="py-2!">
                {c.doctor.name}
              </td>
              <td dir="auto" className="py-2!">
                {c.patientName}
              </td>
              <td dir="auto" className="py-2! text-muted">
                {c.technician?.name ?? '—'}
              </td>
              <td className="num py-2!">{c.receivedDate}</td>
              <td className="py-2! whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span className="num">{c.expectedDate}</span>
                  {c.overdue && <OverdueMarker />}
                </span>
              </td>
              <td className="py-2!">
                <StatusBadge status={c.status} />
              </td>
              <td className={cn('num py-2! text-end font-bold whitespace-nowrap', c.status === 'cancelled' && 'text-muted line-through')}>
                {currency.format(c.total)} {currency.symbol}
              </td>
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
    </>
  );
}
