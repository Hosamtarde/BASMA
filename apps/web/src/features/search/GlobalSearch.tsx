import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCan } from '@/features/auth/permissions';
import { MoneyCell } from '@/features/payments/parts';
import { cn } from '@/lib/cn';
import { isSearchable, searchQuery } from './api';

const DEBOUNCE_MS = 150; // SPEC §5.17

/** Keystrokes aimed at a field must not open the dialog («/» is only a shortcut away from fields). */
function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const item =
  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[14.5px] aria-selected:bg-hover data-[selected=true]:bg-hover';
const heading = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12.5px] [&_[cmdk-group-heading]]:font-extrabold [&_[cmdk-group-heading]]:text-muted';

/**
 * Global search (SPEC §5.17): one box in the top bar, Ctrl/⌘ + K or «/» to open. The server does the
 * matching; this component debounces by 150 ms, waits for an Arabic/CJK composition to finish,
 * cancels outdated requests, and lets the keyboard do everything (↑ ↓ Enter, Esc returns focus here).
 */
export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const composing = useRef(false);

  // Debounce: the query follows the text 150 ms after the last keystroke, never mid-composition.
  useEffect(() => {
    if (composing.current) return;
    const h = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingTarget(e.target) && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const searchable = isSearchable(query);
  const { data, isFetching, isError, refetch } = useQuery({
    ...searchQuery(query),
    enabled: open && searchable,
    placeholderData: keepPreviousData,
    // A failed search is shown in the dialog (with a retry), never as a replacement of the page.
    throwOnError: false,
  });

  if (!can('search.use')) return null;

  const close = () => {
    setOpen(false);
    setText('');
    setQuery('');
  };
  const go = (to: string) => {
    close();
    void navigate(to);
  };
  const encoded = encodeURIComponent(query);
  const groups = data?.groups;
  const total =
    (groups?.doctors?.items.length ?? 0) +
    (groups?.cases?.items.length ?? 0) +
    (groups?.payments?.items.length ?? 0) +
    (groups?.outgoing?.items.length ?? 0);
  const settled = searchable && !!data && !isFetching && data.q === query;
  const none = settled && total === 0;

  let status: string;
  if (!searchable) status = '';
  else if (isError) status = t('search.error');
  else if (!settled) status = t('search.loading');
  else if (none) status = t('search.empty', { q: query });
  else status = t('search.count', { count: total });

  const closest = (g: { closest: boolean } | undefined): ReactNode =>
    g?.closest ? <span className="ms-2 font-semibold text-cyan-ink">· {t('search.closest')}</span> : null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-keyshortcuts="Control+K Meta+K"
          className="flex h-10 w-full max-w-[420px] items-center gap-2.5 rounded-lg border border-control bg-card px-3 text-start text-muted hover:bg-hover"
        >
          <Search aria-hidden="true" className="size-[18px] shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[14px]">{t('search.open')}</span>
          <kbd dir="ltr" className="hidden rounded border border-border px-1.5 text-[12px] font-bold sm:inline">
            {t('search.shortcut')}
          </kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          data-testid="global-search"
          className={cn(
            'fixed inset-x-0 top-[10vh] z-50 mx-auto flex max-h-[min(640px,80dvh)] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-dialog)]',
            'max-sm:inset-0 max-sm:top-0 max-sm:max-h-none max-sm:h-dvh max-sm:w-auto max-sm:rounded-none',
          )}
        >
          <Dialog.Title className="sr-only">{t('search.title')}</Dialog.Title>
          <Dialog.Description className="sr-only">{t('search.description')}</Dialog.Description>
          <Command shouldFilter={false} loop label={t('search.label')} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search aria-hidden="true" className="size-5 shrink-0 text-muted" />
              <Command.Input
                value={text}
                onValueChange={setText}
                placeholder={t('search.placeholder')}
                aria-label={t('search.label')}
                dir="auto"
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(e) => {
                  composing.current = false;
                  setText(e.currentTarget.value);
                  setQuery(e.currentTarget.value.trim());
                }}
                className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
              />
            </div>
            {/* One announcement after the debounce, not one per keystroke. */}
            <div role="status" aria-live="polite" className="sr-only">
              {status}
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
              {!searchable && <p className="px-3 py-6 text-center text-[14px] text-muted">{t('search.hint')}</p>}
              {searchable && !settled && !isError && (
                <p className="px-3 py-6 text-center text-[14px] text-muted" data-testid="search-loading">
                  {t('search.loading')}
                </p>
              )}
              {isError && (
                <div role="alert" className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                  <p className="font-semibold text-danger">{t('search.error')}</p>
                  <button
                    type="button"
                    className="rounded-lg border border-control px-3 py-1.5 font-bold hover:bg-hover"
                    onClick={() => void refetch()}
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
              {none && (
                <div className="px-3 py-6 text-center" data-testid="search-empty">
                  <p className="font-bold">{t('search.empty', { q: query })}</p>
                  <p className="mt-1 text-[13.5px] text-muted">{t('search.emptyHint')}</p>
                </div>
              )}
              {settled && groups?.doctors && groups.doctors.items.length > 0 && (
                <Command.Group
                  className={heading}
                  heading={
                    <>
                      {t('search.groups.doctors')}
                      {closest(groups.doctors)}
                    </>
                  }
                >
                  {groups.doctors.items.map((d) => (
                    <Command.Item key={d.id} value={`doctor-${d.id}`} className={item} onSelect={() => go(`/doctors/${d.id}`)}>
                      <span dir="auto" className="min-w-0 flex-1 truncate font-bold">
                        {d.name}
                      </span>
                      {d.clinic && (
                        <span dir="auto" className="truncate text-[13px] text-muted">
                          {d.clinic}
                        </span>
                      )}
                      {!d.active && <span className="text-[12.5px] font-bold text-muted">{t('search.inactive')}</span>}
                    </Command.Item>
                  ))}
                  {groups.doctors.total > groups.doctors.items.length && (
                    <Command.Item
                      value="all-doctors"
                      className={cn(item, 'font-bold text-cyan-ink')}
                      onSelect={() => go(`/doctors?q=${encoded}&status=all`)}
                    >
                      {t('search.viewAll', { count: groups.doctors.total })}
                    </Command.Item>
                  )}
                </Command.Group>
              )}
              {settled && groups?.cases && groups.cases.items.length > 0 && (
                <Command.Group
                  className={heading}
                  heading={
                    <>
                      {t('search.groups.cases')}
                      {closest(groups.cases)}
                    </>
                  }
                >
                  {groups.cases.items.map((c) => (
                    <Command.Item key={c.id} value={`case-${c.id}`} className={item} onSelect={() => go(`/cases/${c.id}`)}>
                      <span className="num shrink-0 font-extrabold">{t('search.caseLine', { no: c.caseNo })}</span>
                      <span dir="auto" className="min-w-0 flex-1 truncate">
                        {c.patientName}
                      </span>
                      <span dir="auto" className="truncate text-[13px] text-muted">
                        {c.doctorName}
                      </span>
                    </Command.Item>
                  ))}
                  {groups.cases.total > groups.cases.items.length && (
                    <Command.Item
                      value="all-cases"
                      className={cn(item, 'font-bold text-cyan-ink')}
                      onSelect={() => go(`/cases?q=${encoded}`)}
                    >
                      {t('search.viewAll', { count: groups.cases.total })}
                    </Command.Item>
                  )}
                </Command.Group>
              )}
              {settled && groups?.payments && groups.payments.items.length > 0 && (
                <Command.Group className={heading} heading={t('search.groups.payments')}>
                  {groups.payments.items.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`payment-${p.id}`}
                      className={item}
                      onSelect={() => go(`/payments?q=${encodeURIComponent(p.voucher)}`)}
                    >
                      <span className="num shrink-0 font-extrabold">{p.voucher}</span>
                      <span dir="auto" className="min-w-0 flex-1 truncate">
                        {p.doctorName}
                      </span>
                      {p.status === 'void' && <span className="text-[12.5px] font-bold text-muted">{t('search.voided')}</span>}
                      <span className="shrink-0 font-bold">
                        <MoneyCell minor={p.amount} />
                      </span>
                    </Command.Item>
                  ))}
                  {groups.payments.total > groups.payments.items.length && (
                    <Command.Item
                      value="all-payments"
                      className={cn(item, 'font-bold text-cyan-ink')}
                      onSelect={() => go(`/payments?q=${encoded}`)}
                    >
                      {t('search.viewAll', { count: groups.payments.total })}
                    </Command.Item>
                  )}
                </Command.Group>
              )}
              {settled && groups?.outgoing && groups.outgoing.items.length > 0 && (
                <Command.Group
                  className={heading}
                  heading={
                    <>
                      {t('search.groups.outgoing')}
                      {closest(groups.outgoing)}
                    </>
                  }
                >
                  {groups.outgoing.items.map((o) => (
                    <Command.Item
                      key={o.id}
                      value={`outgoing-${o.id}`}
                      className={item}
                      onSelect={() => go(`/outgoing?q=${encodeURIComponent(o.voucher)}`)}
                    >
                      <span className="num shrink-0 font-extrabold">{o.voucher}</span>
                      <span dir="auto" className="min-w-0 flex-1 truncate">
                        {o.partyName}
                      </span>
                      <span dir="auto" className="truncate text-[13px] text-muted">
                        {o.categoryName}
                      </span>
                      {o.status === 'void' && <span className="text-[12.5px] font-bold text-muted">{t('search.voided')}</span>}
                      <span className="shrink-0 font-bold">
                        <MoneyCell minor={o.amount} />
                      </span>
                    </Command.Item>
                  ))}
                  {groups.outgoing.total > groups.outgoing.items.length && (
                    <Command.Item
                      value="all-outgoing"
                      className={cn(item, 'font-bold text-cyan-ink')}
                      onSelect={() => go(`/outgoing?q=${encoded}`)}
                    >
                      {t('search.viewAll', { count: groups.outgoing.total })}
                    </Command.Item>
                  )}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
