import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/**
 * Arabic letter folding for FINDING only (B4, owner decision O5): stored names are never changed and
 * uniqueness still compares exact letters (owner rule B1). Two spellings that differ only by hamza,
 * ta marbuta, alef maqsura or tashkeel match each other in the search box.
 *
 *   أ إ آ ٱ → ا     ى → ي     ة → ه     tashkeel (ً ٌ ٍ َ ُ ِ ّ ْ ٰ) and tatweel (ـ) are dropped
 */
export const FOLD_FROM = 'أإآٱىةـًٌٍَُِّْٰ';
export const FOLD_TO = 'اااايه'; // PostgreSQL translate() deletes the from-characters that have no counterpart here

const FOLD_MAP = new Map<string, string>([...FOLD_FROM].map((ch, i) => [ch, FOLD_TO[i] ?? '']));

/** The query side of the fold: NFC, lower-case, folded letters, single spaces. */
export function foldText(value: string): string {
  let out = '';
  for (const ch of value.normalize('NFC').toLowerCase()) out += FOLD_MAP.get(ch) ?? ch;
  return out.replace(/\s+/gu, ' ').trim();
}

/** The column side: the same fold in SQL (translate + lower), so both sides always agree. */
export function foldSql(column: SQL): SQL {
  return sql`translate(lower(${column}), ${FOLD_FROM}, ${FOLD_TO})`;
}

/** Words of at least two characters of a folded query (a one-letter word matches everything). */
export function searchTokens(folded: string): string[] {
  return [...new Set(folded.split(' ').filter((w) => [...w].length >= 2))];
}
