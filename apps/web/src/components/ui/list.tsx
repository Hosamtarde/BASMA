import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/i18n/format';
import { currentLanguage } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { useUrlState } from '@/lib/url-state';
import { Button } from './button';

export type StatusFilter = 'active' | 'inactive' | 'all';

const STATUSES: readonly StatusFilter[] = ['active', 'inactive', 'all'];

interface ListState {
  q: string;
  status: StatusFilter;
  page: number;
}

function parseList(params: URLSearchParams, defaultStatus: StatusFilter): ListState {
  const raw = params.get('status') as StatusFilter | null;
  return {
    q: params.get('q') ?? '',
    status: raw && STATUSES.includes(raw) ? raw : defaultStatus,
    page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
  };
}

/** Only meaningful values reach the address: no empty search, no default status, no page 1. */
function serializeList(state: ListState, defaultStatus: StatusFilter): URLSearchParams {
  const out = new URLSearchParams();
  if (state.q.trim() !== '') out.set('q', state.q.trim());
  if (state.status !== defaultStatus) out.set('status', state.status);
  if (state.page > 1) out.set('page', String(state.page));
  return out;
}

/**
 * List state in the URL (search, status, page) so reload, back/forward and shared links keep it,
 * through useUrlState: the controls answer at once and quick successive changes never overwrite
 * each other. A new search or filter starts again on page 1.
 */
export function useListParams(defaultStatus: StatusFilter = 'active') {
  const [state, setState] = useUrlState(
    (p) => parseList(p, defaultStatus),
    (s) => serializeList(s, defaultStatus),
  );
  const update = (patch: { q?: string; status?: StatusFilter; page?: number }) =>
    setState((prev) => ({
      q: patch.q ?? prev.q,
      status: patch.status ?? prev.status,
      page: patch.page ?? (patch.q !== undefined || patch.status !== undefined ? 1 : prev.page),
    }));
  const active = state.status === 'all' ? undefined : state.status === 'active';
  return { search: state.q, status: state.status, page: state.page, active, update };
}

/** Same API as useListParams, kept in component state (for lists inside dialogs). */
export function useLocalListParams(defaultStatus: StatusFilter = 'active'): ReturnType<typeof useListParams> {
  const [state, setState] = useState({ search: '', status: defaultStatus, page: 1 });
  const update = (patch: { q?: string; status?: StatusFilter; page?: number }) =>
    setState((prev) => ({
      search: patch.q ?? prev.search,
      status: patch.status ?? prev.status,
      page: patch.page ?? (patch.q !== undefined || patch.status !== undefined ? 1 : prev.page),
    }));
  const active = state.status === 'all' ? undefined : state.status === 'active';
  return { ...state, active, update };
}

/** Search box that waits for a short pause before updating the list (SPEC §5.17: 150 ms). */
export function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [text, setText] = useState(value);
  // Follow a value changed from outside (back/forward, «clear filters»), not our own echo.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== text.trim()) setText(value);
  }
  useEffect(() => {
    const handle = setTimeout(() => {
      if (text.trim() !== value) onChange(text.trim());
    }, 250);
    return () => clearTimeout(handle);
  }, [text, value, onChange]);
  return (
    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-focus md:max-w-sm">
      <Search aria-hidden="true" className="size-[18px] shrink-0 text-muted" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        dir="auto"
        value={text}
        placeholder={label}
        onChange={(e) => setText(e.target.value)}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
      />
    </label>
  );
}

export function StatusSelect({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[14px] font-bold text-muted">
        {t('list.status')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as StatusFilter)}
        className="h-10 rounded-[var(--radius-control)] border border-control bg-card px-3 pe-8"
      >
        <option value="active">{t('list.active')}</option>
        <option value="inactive">{t('list.inactive')}</option>
        <option value="all">{t('list.all')}</option>
      </select>
    </div>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-bold whitespace-nowrap',
        active ? 'bg-success-bg text-success-ink' : 'bg-st-cancelled-bg text-st-cancelled-ink',
      )}
    >
      <i
        aria-hidden="true"
        className={cn('size-2 rounded-full', active ? 'bg-st-ready' : 'bg-st-cancelled')}
      />
      {active ? t('list.active') : t('list.inactive')}
    </span>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Reading direction: "previous" points to the reading start.
  const Prev = lang === 'ar' ? ChevronRight : ChevronLeft;
  const Next = lang === 'ar' ? ChevronLeft : ChevronRight;
  return (
    <nav
      aria-label={t('list.pagination')}
      className="flex flex-wrap items-center justify-between gap-3 pt-3 text-[13.5px] text-muted"
    >
      <span>{t('list.total', { count: total, formatted: formatNumber(total, lang) })}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('list.previous')}
        >
          <Prev aria-hidden="true" />
        </Button>
        <span aria-live="polite">
          {t('list.pageOf', { page: formatNumber(page, lang), pages: formatNumber(pages, lang) })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('list.next')}
        >
          <Next aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/** Table frame with a caption for screen readers and a real empty state. */
export function DataTable({
  caption,
  head,
  children,
  empty,
  emptyText,
}: {
  caption: string;
  head: ReactNode;
  children: ReactNode;
  empty: boolean;
  emptyText: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-[13px] text-muted [&_th]:px-3 [&_th]:py-2.5 [&_th]:font-bold [&_th]:whitespace-nowrap">
            {head}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-b-border [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_tr:hover]:bg-hover">
          {empty ? (
            <tr>
              <td colSpan={99} className="py-8! text-center text-muted">
                {emptyText}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mt-4 mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[24px] leading-tight font-extrabold">{title}</h1>
        {intro && <p className="mt-1 text-[14px] text-muted">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[var(--radius-card)] border border-border bg-card p-5', className)}>
      {children}
    </section>
  );
}
