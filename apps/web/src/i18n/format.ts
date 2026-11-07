import type { Language } from './i18n';

/**
 * Locale per UI language. Western digits (0-9) in both languages (SPEC §1); Arabic-Indic digits
 * are a later setting (`ar` without `-u-nu-latn`).
 */
export const localeOf = (lang: Language): string => (lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB');

export function formatNumber(value: number, lang: Language, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeOf(lang), options).format(value);
}

/** Dates are shown as stored, YYYY-MM-DD, in both languages (SPEC §6). */
export function formatIsoDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`not an ISO date: ${isoDate}`);
  return isoDate;
}

/** Weekday name of an ISO date, in the UI language (calendar date, no time-zone shift). */
export function formatWeekday(isoDate: string, lang: Language): string {
  const [y, m, d] = formatIsoDate(isoDate).split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Today's calendar date (YYYY-MM-DD) in a time zone; the lab's zone comes from settings. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A timestamp as `YYYY-MM-DD HH:mm` in the lab's time zone (24-hour, Western digits). */
export function formatDateTimeIn(isoTimestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoTimestamp));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
