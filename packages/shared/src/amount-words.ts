/**
 * An amount in words for printed vouchers (SPEC §5.8, B6b), Arabic and English. Input is integer minor units
 * (SPEC §7.1) and the currency's decimals; no floating point: the amount is split with integer division
 * (every amount is below 2^53, see MAX_AMOUNT_MINOR) and the words are built from the integer parts.
 *
 * Known currencies use their unit names with Arabic number agreement (1 singular, 2 dual, 3–10 plural,
 * 11–99 and 100+ singular) and the gender of the minor unit; an unknown code, or a decimals setting that is not
 * the currency's usual one, prints the code and the fraction as a number («1000 XYZ و50/100»). Plain wording
 * without diacritics, as printed on cheques.
 */
import type { DocumentLanguage } from './invoice.ts';

interface UnitNames {
  one: string;
  two: string;
  few: string;
  many: string;
  /** Arabic gender of the noun: decides the form of the numerals 1–10. */
  feminine: boolean;
}
interface CurrencyNames {
  decimals: number;
  ar: { major: UnitNames; minor: UnitNames };
  en: { major: [string, string]; minor: [string, string] };
}

const m = (one: string, two: string, few: string, many = one, feminine = false): UnitNames => ({ one, two, few, many, feminine });

const CURRENCIES: Record<string, CurrencyNames> = {
  ILS: {
    decimals: 2,
    ar: { major: m('شيكل', 'شيكلان', 'شواكل'), minor: m('أغورة', 'أغورتان', 'أغورات', 'أغورة', true) },
    en: { major: ['shekel', 'shekels'], minor: ['agora', 'agorot'] },
  },
  JOD: {
    decimals: 3,
    ar: { major: m('دينار', 'ديناران', 'دنانير'), minor: m('فلس', 'فلسان', 'فلوس') },
    en: { major: ['dinar', 'dinars'], minor: ['fils', 'fils'] },
  },
  USD: {
    decimals: 2,
    ar: { major: m('دولار', 'دولاران', 'دولارات'), minor: m('سنت', 'سنتان', 'سنتات') },
    en: { major: ['dollar', 'dollars'], minor: ['cent', 'cents'] },
  },
  EUR: {
    decimals: 2,
    ar: { major: m('يورو', 'يورو', 'يورو'), minor: m('سنت', 'سنتان', 'سنتات') },
    en: { major: ['euro', 'euros'], minor: ['cent', 'cents'] },
  },
  EGP: {
    decimals: 2,
    ar: { major: m('جنيه', 'جنيهان', 'جنيهات'), minor: m('قرش', 'قرشان', 'قروش') },
    en: { major: ['pound', 'pounds'], minor: ['piastre', 'piastres'] },
  },
  SAR: {
    decimals: 2,
    ar: { major: m('ريال', 'ريالان', 'ريالات'), minor: m('هللة', 'هللتان', 'هللات', 'هللة', true) },
    en: { major: ['riyal', 'riyals'], minor: ['halala', 'halalas'] },
  },
  AED: {
    decimals: 2,
    ar: { major: m('درهم', 'درهمان', 'دراهم'), minor: m('فلس', 'فلسان', 'فلوس') },
    en: { major: ['dirham', 'dirhams'], minor: ['fils', 'fils'] },
  },
};

// ------------------------------------------------------------------ English

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion'];

function enBelowThousand(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(`${EN_ONES[hundreds]!} hundred`);
  if (rest > 0) {
    if (rest < 20) words.push(EN_ONES[rest]!);
    else {
      const unit = rest % 10;
      words.push(unit === 0 ? EN_TENS[Math.floor(rest / 10)]! : `${EN_TENS[Math.floor(rest / 10)]!}-${EN_ONES[unit]!}`);
    }
  }
  return words.join(' ');
}

function enNumber(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  for (let scale = EN_SCALES.length - 1; scale >= 0; scale -= 1) {
    const chunk = Math.floor(n / 1000 ** scale) % 1000;
    if (chunk > 0) parts.push(`${enBelowThousand(chunk)}${scale > 0 ? ` ${EN_SCALES[scale]!}` : ''}`);
  }
  return parts.join(' ');
}

// ------------------------------------------------------------------ Arabic

const AR_ONES_M = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const AR_ONES_F = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع', 'عشر'];
const AR_TEENS_M = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TEENS_F = ['عشر', 'إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

/** 1..99 in the given gender (feminine nouns take the feminine numeral for 1–2 and the short form for 3–10). */
function arUnderHundred(n: number, feminine: boolean): string {
  const ones = feminine ? AR_ONES_F : AR_ONES_M;
  if (n <= 10) return ones[n]!;
  if (n < 20) return (feminine ? AR_TEENS_F : AR_TEENS_M)[n - 10]!;
  const unit = n % 10;
  const tens = AR_TENS[Math.floor(n / 10)]!;
  return unit === 0 ? tens : `${ones[unit]!} و${tens}`;
}

/** 1..999 as a list of parts joined with «و». `construct` writes 200 as «مئتا» (before «ألف»). */
function arBelowThousand(n: number, feminine: boolean, construct = false): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(construct && hundreds === 2 && rest === 0 ? 'مئتا' : AR_HUNDREDS[hundreds]!);
  if (rest > 0) parts.push(arUnderHundred(rest, feminine));
  return parts.join(' و');
}

const AR_SCALE = [
  null,
  { one: 'ألف', two: 'ألفان', few: 'آلاف', many: 'ألف' },
  { one: 'مليون', two: 'مليونان', few: 'ملايين', many: 'مليون' },
  { one: 'مليار', two: 'ملياران', few: 'مليارات', many: 'مليار' },
] as const;

/** The whole-number words of an amount (the counted noun's gender decides the units chunk). */
function arNumber(n: number, feminine: boolean): string {
  const parts: string[] = [];
  for (let scale = AR_SCALE.length - 1; scale >= 1; scale -= 1) {
    const chunk = Math.floor(n / 1000 ** scale) % 1000;
    if (chunk === 0) continue;
    const names = AR_SCALE[scale]!;
    const rest = chunk % 100;
    if (chunk === 1) parts.push(names.one);
    else if (chunk === 2) parts.push(names.two);
    else if (rest >= 3 && rest <= 10) parts.push(`${arBelowThousand(chunk, false)} ${names.few}`);
    else parts.push(`${arBelowThousand(chunk, false, true)} ${names.many}`);
  }
  const units = n % 1000;
  if (units > 0) parts.push(arBelowThousand(units, feminine));
  return parts.join(' و');
}

/** A counted amount with its noun: «شيكل واحد», «شيكلان», «ثلاثة شواكل», «خمسون أغورة», «مئة شيكل». */
function arCounted(n: number, names: UnitNames): string {
  if (n === 1) return `${names.one} ${names.feminine ? 'واحدة' : 'واحد'}`;
  if (n === 2) return names.two;
  const rest = n % 100;
  const noun = rest >= 3 && rest <= 10 ? names.few : names.many;
  return `${arNumber(n, names.feminine)} ${noun}`;
}

// ------------------------------------------------------------------ public

/**
 * `minor` in words for a currency with `decimals` places (0–3), in `language`. Zero is written («صفر», «Zero»);
 * a zero major part with a minor part is written too («Zero shekels and one agora»).
 */
export function amountInWords(minor: number, decimals: number, currencyCode: string, language: DocumentLanguage): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError(`amount must be a non-negative integer, got ${minor}`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) throw new RangeError(`currency decimals must be 0-3, got ${decimals}`);
  const scale = 10 ** decimals;
  const major = Math.floor(minor / scale);
  const fraction = minor % scale;
  const known = CURRENCIES[currencyCode.trim().toUpperCase()];
  const usable = known !== undefined && (decimals === known.decimals || decimals === 0) ? known : undefined;

  if (language === 'en') {
    const text = (() => {
      if (usable === undefined) {
        const head = `${enNumber(major)} ${currencyCode.trim().toUpperCase()}`;
        return fraction === 0 ? head : `${head} and ${String(fraction).padStart(decimals, '0')}/${scale}`;
      }
      const noun = (n: number, names: [string, string]) => (n === 1 ? names[0] : names[1]);
      const head = `${enNumber(major)} ${noun(major, usable.en.major)}`;
      return fraction === 0 ? head : `${head} and ${enNumber(fraction)} ${noun(fraction, usable.en.minor)}`;
    })();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  if (usable === undefined) {
    const head = `${major === 0 ? 'صفر' : arNumber(major, false)} ${currencyCode.trim().toUpperCase()}`;
    return fraction === 0 ? head : `${head} و${String(fraction).padStart(decimals, '0')}/${scale}`;
  }
  const head = major === 0 ? `صفر ${usable.ar.major.many}` : arCounted(major, usable.ar.major);
  return fraction === 0 ? head : `${head} و${arCounted(fraction, usable.ar.minor)}`;
}
