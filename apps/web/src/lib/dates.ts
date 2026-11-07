/**
 * Calendar dates as the API stores them: `YYYY-MM-DD` strings (SPEC §6), never Date objects with
 * a time zone. "Today" is the lab's date (`todayIn(labTimeZone)`), not the browser's.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN = '۰۱۲۳۴۵۶۷۸۹';

/** As the user types: keeps digits (Arabic-Indic too), at most 8, and inserts the dashes. */
export function maskIsoDate(input: string): string {
  let digits = '';
  for (const ch of input) {
    const a = ARABIC_INDIC.indexOf(ch);
    const e = EASTERN.indexOf(ch);
    if (a >= 0) digits += String(a);
    else if (e >= 0) digits += String(e);
    else if (ch >= '0' && ch <= '9') digits += ch;
  }
  digits = digits.slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** A real calendar date in YYYY-MM-DD (no 2026-02-30). */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** For the calendar widget, which works with local Date objects at local midnight. */
export function isoToLocalDate(iso: string): Date | undefined {
  if (!isIsoDate(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function localDateToIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
