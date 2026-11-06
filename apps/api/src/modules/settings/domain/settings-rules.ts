import type { Language } from '../../../shared/i18n/i18n.service';

export const LAB_PROFILE = 'lab_profile';
export const CURRENCY = 'currency';
export const LANGUAGE = 'language';

export interface LabProfile {
  nameAr: string | null;
  nameEn: string | null;
  phone: string | null;
  address: string | null;
  /** IANA name; "today" for the lab is computed in this zone (assessment §2.2 deviation 6). */
  timeZone: string;
}

export interface CurrencySetting {
  code: string;
  symbol: string;
  /** Minor-unit digits, 0–3 (SPEC §5.18). */
  decimals: number;
}

export interface LanguageSetting {
  ui: Language;
  /** Language of printed documents; may differ from the UI (SPEC §6.1). */
  documents: Language;
}

export const COUNTER_NAMES = ['case_no', 'invoice_no'] as const;
export type CounterName = (typeof COUNTER_NAMES)[number];

export interface Counter {
  startValue: number;
  nextValue: number;
}

export const MAX_COUNTER_START = 999_999_999;

/**
 * Owner rule (B1): once any money amount exists, the currency code and decimals are locked
 * (amounts are never converted); the symbol is cosmetic and stays editable.
 */
export function lockedCurrencyFields(
  current: CurrencySetting,
  requested: Partial<CurrencySetting>,
  hasMoneyData: boolean,
): (keyof CurrencySetting)[] {
  if (!hasMoneyData) return [];
  const locked: (keyof CurrencySetting)[] = [];
  if (requested.code !== undefined && requested.code !== current.code) locked.push('code');
  if (requested.decimals !== undefined && requested.decimals !== current.decimals) locked.push('decimals');
  return locked;
}

/** A number was issued once next_value moved past the chosen start. */
export const isCounterLocked = (counter: Counter): boolean => counter.nextValue !== counter.startValue;

/**
 * Owner rule (B1, addition C): the first number may change only while nothing was issued
 * (next_value = start_value), and next_value moves together with it. Returns null when locked.
 */
export function withNewStart(counter: Counter, start: number): Counter | null {
  if (isCounterLocked(counter)) return null;
  return { startValue: start, nextValue: start };
}

/** Lab profile needs a name in at least one language (SPEC §5.18 first-run: lab name required). */
export const hasLabName = (p: Pick<LabProfile, 'nameAr' | 'nameEn'>): boolean =>
  Boolean(p.nameAr?.trim() || p.nameEn?.trim());

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
