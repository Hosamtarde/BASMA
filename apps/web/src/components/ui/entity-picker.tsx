import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface PickerOption {
  id: number;
  name: string;
  /** Shown after the name in the list (e.g. a price). */
  detail?: string;
}

export interface EntityPickerProps<T extends PickerOption> {
  label: string;
  value: T | null;
  onChange: (o: T | null) => void;
  /** Query key per search text, inside the entity's key family so writes refresh it. */
  queryKey: (search: string) => readonly unknown[];
  load: (search: string) => Promise<T[]>;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  /** Text of the empty choice ("no technician", "all doctors"); without it a choice is required. */
  emptyLabel?: string;
  /** Extra control beside the label (e.g. «+ أضف طبيبًا آخر»). */
  action?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Searchable single choice (cmdk in a Radix popover). The trigger is a select-only combobox
 * named by the visible label; the popover holds the search box and the options. The server does
 * the searching (active records only), so long lists stay fast.
 */
export function EntityPicker<T extends PickerOption>({
  label,
  value,
  onChange,
  queryKey,
  load,
  required,
  error,
  hint,
  emptyLabel,
  action,
  disabled,
  className,
}: EntityPickerProps<T>) {
  const { t } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setSearch(text.trim()), 200);
    return () => clearTimeout(h);
  }, [text]);
  const { data, isFetching } = useQuery({
    queryKey: queryKey(search),
    queryFn: () => load(search),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const choose = (o: T | null) => {
    onChange(o);
    setOpen(false);
    setText('');
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline gap-1 text-[14px] font-bold">
        <span id={labelId}>{label}</span>
        {required && (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        )}
        {action && <span className="ms-auto font-semibold">{action}</span>}
      </div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            role="combobox"
            aria-labelledby={labelId}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={`${id}-popup`}
            aria-invalid={error ? true : undefined}
            aria-required={required || undefined}
            aria-describedby={describedBy}
            className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-control bg-card px-3 text-start outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger"
          >
            <span dir="auto" className={cn('min-w-0 flex-1 truncate', !value && 'text-muted')}>
              {value ? value.name : (emptyLabel ?? t('picker.choose'))}
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            id={`${id}-popup`}
            align="start"
            sideOffset={4}
            aria-label={label}
            className="z-[60] w-[max(var(--radix-popover-trigger-width),240px)] rounded-[var(--radius-control)] border border-border bg-card p-1 shadow-[var(--shadow-dialog)]"
          >
            {/* cmdk names the search box after the root label and the list after its own label. */}
            <Command shouldFilter={false} label={t('picker.search')} loop>
              <Command.Input
                value={text}
                onValueChange={setText}
                placeholder={t('picker.search')}
                dir="auto"
                className="mb-1 h-9 w-full rounded-md border border-border bg-surface px-2.5 outline-none focus-visible:outline-2 focus-visible:outline-focus"
              />
              <Command.List label={t('picker.results')} className="max-h-64 overflow-y-auto">
                {isFetching && !data && (
                  <Command.Loading>
                    <span className="block px-2.5 py-2 text-[13.5px] text-muted">{t('picker.loading')}</span>
                  </Command.Loading>
                )}
                {emptyLabel && search === '' && (
                  <Command.Item
                    value="__empty__"
                    onSelect={() => choose(null)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-muted data-[selected=true]:bg-info-bg"
                  >
                    <Check aria-hidden="true" className={cn('size-4', value ? 'invisible' : '')} />
                    {emptyLabel}
                  </Command.Item>
                )}
                {data?.map((o) => (
                  <Command.Item
                    key={o.id}
                    value={String(o.id)}
                    onSelect={() => choose(o)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 data-[selected=true]:bg-info-bg"
                  >
                    <Check aria-hidden="true" className={cn('size-4 shrink-0', value?.id === o.id ? '' : 'invisible')} />
                    <span dir="auto" className="min-w-0 flex-1 truncate">
                      {o.name}
                    </span>
                    {o.detail && <span className="num text-[13px] text-muted">{o.detail}</span>}
                  </Command.Item>
                ))}
                {data && (
                  <Command.Empty className="px-2.5 py-2 text-[13.5px] text-muted">{t('picker.noResults')}</Command.Empty>
                )}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
