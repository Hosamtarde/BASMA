/**
 * Money for the UI, in integer minor units only (SPEC §7.1). No floating-point maths anywhere:
 * text ↔ minor units goes through strings and BigInt. The API is the authority on every amount;
 * this module only reads what the user types and shows what the API returns.
 */

/** Same bound as the API (apps/api/src/shared/money/limits.ts). */
export const MAX_AMOUNT_MINOR = 999_999_999_999;

export type MoneyParseError = 'empty' | 'format' | 'tooManyDecimals' | 'negative' | 'tooLarge';
export type MoneyParseResult = { ok: true; minor: number } | { ok: false; error: MoneyParseError };

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) {
    throw new RangeError(`currency decimals must be 0-3, got ${decimals}`);
  }
}

/** Arabic-Indic digits, the Arabic decimal mark and the minus sign become plain ASCII. */
function normalize(input: string): string {
  let out = '';
  for (const ch of input.trim()) {
    const a = ARABIC_INDIC.indexOf(ch);
    const e = EASTERN_ARABIC_INDIC.indexOf(ch);
    if (a >= 0) out += String(a);
    else if (e >= 0) out += String(e);
    else if (ch === '٫') out += '.';
    else if (ch === '٬') out += ',';
    else if (ch === '−') out += '-';
    else out += ch;
  }
  return out;
}

/**
 * Parses what the user typed ("1,234.5", "-20", "٣٥٠") into minor units for a currency with
 * `decimals` places. More decimals than the currency has is an error, never a silent rounding.
 * Thousands separators are accepted only in correct groups of three.
 */
export function parseMoney(input: string, decimals: number, options: { allowNegative?: boolean } = {}): MoneyParseResult {
  assertDecimals(decimals);
  const text = normalize(input);
  if (text === '') return { ok: false, error: 'empty' };
  const m = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === undefined && (m[3] === undefined || m[3] === ''))) return { ok: false, error: 'format' };
  const negative = m[1] === '-';
  const whole = (m[2] ?? '0').replaceAll(',', '');
  const fraction = m[3] ?? '';
  if (fraction.length > decimals) return { ok: false, error: 'tooManyDecimals' };
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (minor > BigInt(MAX_AMOUNT_MINOR)) return { ok: false, error: 'tooLarge' };
  if (negative && minor !== 0n && !options.allowNegative) return { ok: false, error: 'negative' };
  return { ok: true, minor: negative && minor !== 0n ? -Number(minor) : Number(minor) };
}

function split(minor: number, decimals: number): { negative: boolean; whole: bigint; fraction: string } {
  assertDecimals(decimals);
  if (!Number.isSafeInteger(minor)) throw new RangeError(`money must be an integer in minor units, got ${minor}`);
  const abs = BigInt(Math.abs(minor));
  const scale = 10n ** BigInt(decimals);
  return {
    negative: minor < 0,
    whole: abs / scale,
    fraction: decimals === 0 ? '' : (abs % scale).toString().padStart(decimals, '0'),
  };
}

/** For display: grouped whole part (locale grouping, Western digits by default), fixed decimals. */
export function formatMoney(minor: number, decimals: number, locale = 'en'): string {
  const { negative, whole, fraction } = split(minor, decimals);
  const grouped = new Intl.NumberFormat(locale, { useGrouping: true }).format(whole);
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** For an input box: no grouping, so the text parses back to the same amount. */
export function toMoneyInput(minor: number, decimals: number): string {
  const { negative, whole, fraction } = split(minor, decimals);
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Sum of amounts in minor units (e.g. a preview subtotal of case lines). Every term and the result
 * must be safe integers, so the sum is exact; a subtraction is a negative term.
 */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`money must be an integer in minor units, got ${v}`);
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('money sum is out of range');
  }
  return total;
}
