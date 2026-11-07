/**
 * Plural-aware parity of the UI catalogs (SPEC §6.1). Keys are compared by their *base* name:
 * `hint_one`/`hint_other` (English) and `hint_zero`…`hint_other` (Arabic) are the same entry.
 * A plural entry must have exactly the plural forms its language uses (Intl.PluralRules),
 * optionally plus `_zero`, and both languages must use the same {{placeholders}}.
 */

export type Catalog = { [key: string]: string | Catalog };

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const PLURAL_RE = new RegExp(`^(.+)_(${PLURAL_SUFFIXES.join('|')})$`);
const PLACEHOLDER_RE = /{{\s*([\w.]+)\s*(?:,[^}]*)?}}/g;

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }`. Non-string leaves are reported as problems. */
export function flatten(
  catalog: Catalog,
  prefix = '',
  out: Record<string, string> = {},
  problems: string[] = [],
) {
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value !== null && typeof value === 'object') flatten(value, path, out, problems);
    else problems.push(`${path}: value must be a string or an object`);
  }
  return { keys: out, problems };
}

interface Entry {
  forms: Set<string> | null; // null = not plural
  placeholders: Set<string>;
}

function entriesOf(flat: Record<string, string>): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const [key, text] of Object.entries(flat)) {
    const m = PLURAL_RE.exec(key);
    const base = m?.[1] ?? key;
    const entry = entries.get(base) ?? {
      forms: m ? new Set<string>() : null,
      placeholders: new Set<string>(),
    };
    if (m?.[2] !== undefined) {
      entry.forms ??= new Set<string>();
      entry.forms.add(m[2]);
    }
    for (const p of text.matchAll(PLACEHOLDER_RE)) if (p[1] !== undefined) entry.placeholders.add(p[1]);
    entries.set(base, entry);
  }
  return entries;
}

const sorted = (s: Iterable<string>) => [...s].sort().join(', ');

/** Returns every problem found; an empty list means the catalogs are in parity. */
export function checkParity(catalogs: Record<string, Catalog>): string[] {
  const problems: string[] = [];
  const byLang = new Map<string, Map<string, Entry>>();

  for (const [lang, catalog] of Object.entries(catalogs)) {
    const { keys, problems: shape } = flatten(catalog);
    problems.push(...shape.map((p) => `[${lang}] ${p}`));
    for (const [key, text] of Object.entries(keys)) {
      if (text.trim() === '') problems.push(`[${lang}] ${key}: empty text`);
    }
    const entries = entriesOf(keys);
    const required = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    for (const [base, entry] of entries) {
      if (entry.forms === null) continue;
      const missing = required.filter((c) => !entry.forms?.has(c));
      const extra = [...entry.forms].filter(
        (c) => !required.includes(c as Intl.LDMLPluralRule) && c !== 'zero',
      );
      if (missing.length > 0) problems.push(`[${lang}] ${base}: missing plural forms ${sorted(missing)}`);
      if (extra.length > 0)
        problems.push(`[${lang}] ${base}: plural forms not used by ${lang}: ${sorted(extra)}`);
    }
    byLang.set(lang, entries);
  }

  const langs = [...byLang.keys()];
  const allBases = new Set(langs.flatMap((l) => [...(byLang.get(l)?.keys() ?? [])]));
  for (const base of [...allBases].sort()) {
    const present = langs.filter((l) => byLang.get(l)?.has(base));
    const absent = langs.filter((l) => !byLang.get(l)?.has(base));
    if (absent.length > 0) {
      problems.push(`${base}: missing in ${absent.join(', ')} (present in ${present.join(', ')})`);
      continue;
    }
    const entries = langs.map((l) => byLang.get(l)?.get(base) as Entry);
    if (new Set(entries.map((e) => e.forms === null)).size > 1) {
      problems.push(`${base}: plural in some languages but not in others`);
    }
    const placeholderSets = new Set(entries.map((e) => sorted(e.placeholders)));
    if (placeholderSets.size > 1) {
      problems.push(
        `${base}: placeholders differ (${langs.map((l, i) => `${l}: {${sorted(entries[i]?.placeholders ?? [])}}`).join('; ')})`,
      );
    }
  }
  return problems;
}
