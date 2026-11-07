import { CalendarDays } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId, useState } from 'react';
import type { Ref } from 'react';
import { DayPicker } from 'react-day-picker';
import { ar, enGB } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { useTranslation } from 'react-i18next';
import { localeOf } from '@/i18n/format';
import { currentLanguage, directionOf } from '@/i18n/i18n';
import { cn } from '@/lib/cn';
import { isoToLocalDate, localDateToIso, maskIsoDate } from '@/lib/dates';

export interface DateFieldProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  onBlur?: () => void;
  name?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** The lab's today (YYYY-MM-DD), marked in the calendar and shown when nothing is chosen. */
  today: string;
  min?: string | undefined;
  max?: string | undefined;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
}

/**
 * A date as the API stores it: a masked YYYY-MM-DD text box (typing stays fast, digits only)
 * plus a calendar popover in the UI language with the lab's "today". Western digits.
 */
export function DateField({
  label,
  value,
  onChange,
  onBlur,
  name,
  inputRef,
  today,
  min,
  max,
  required,
  error,
  hint,
  className,
}: DateFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const lang = currentLanguage();
  const selected = isoToLocalDate(value);
  const todayDate = isoToLocalDate(today);
  const minDate = min ? isoToLocalDate(min) : undefined;
  const maxDate = max ? isoToLocalDate(max) : undefined;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const monthFmt = new Intl.DateTimeFormat(localeOf(lang), { month: 'long', year: 'numeric' });

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline gap-1 text-[14px] font-bold">
        <label htmlFor={id}>{label}</label>
        {required && (
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        )}
      </div>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          {/* The calendar button and the end padding follow the LTR date box, in both languages. */}
          <div className="relative" dir="ltr">
            <input
              id={id}
              ref={inputRef}
              name={name}
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              maxLength={10}
              placeholder={t('date.placeholder')}
              value={value}
              aria-invalid={error ? true : undefined}
              aria-required={required || undefined}
              aria-describedby={describedBy}
              onChange={(e) => onChange(maskIsoDate(e.target.value))}
              onBlur={onBlur}
              className="num h-10 w-full min-w-0 rounded-lg border border-control bg-card ps-3 pe-11 text-start outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-[invalid=true]:border-danger"
            />
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={t('date.openCalendar', { label })}
                className="absolute inset-y-0 end-1 my-auto grid size-8 place-items-center rounded-md text-muted hover:bg-hover"
              >
                <CalendarDays aria-hidden="true" className="size-[18px]" />
              </button>
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            aria-label={t('date.calendar', { label })}
            className="z-[60] rounded-[var(--radius-card)] border border-border bg-card p-3 shadow-[var(--shadow-dialog)] [--rdp-accent-background-color:var(--color-info-bg)] [--rdp-accent-color:var(--color-blue)] [--rdp-today-color:var(--color-blue)] [--rdp-weekday-opacity:1]"
          >
            <DayPicker
              mode="single"
              selected={selected}
              defaultMonth={selected ?? todayDate}
              today={todayDate}
              onSelect={(d) => {
                if (!d) return;
                onChange(localDateToIso(d));
                setOpen(false);
              }}
              disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
              dir={directionOf(lang)}
              locale={lang === 'ar' ? ar : enGB}
              numerals="latn"
              formatters={{ formatCaption: (d) => monthFmt.format(d) }}
            />
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
