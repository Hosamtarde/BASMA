/**
 * CI gate (ADR-0007): ar.json and en.json must have identical keys
 * and the same {placeholders} in every message.
 */
import ar from '../src/shared/i18n/catalogs/ar.json';
import en from '../src/shared/i18n/catalogs/en.json';

const placeholders = (text: string): string =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const catalogs: Record<string, Record<string, string>> = { ar, en };
const allKeys = new Set(Object.values(catalogs).flatMap((c) => Object.keys(c)));
const problems: string[] = [];

for (const key of [...allKeys].sort()) {
  const missingIn = Object.entries(catalogs)
    .filter(([, c]) => c[key] === undefined)
    .map(([lang]) => lang);
  if (missingIn.length > 0) {
    problems.push(`"${key}" missing in: ${missingIn.join(', ')}`);
    continue;
  }
  if (placeholders(catalogs.ar?.[key] ?? '') !== placeholders(catalogs.en?.[key] ?? '')) {
    problems.push(`"${key}" has different {placeholders} in ar and en`);
  }
}

if (problems.length > 0) {
  console.error(`i18n check failed:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`i18n check passed: ${allKeys.size} keys in ar and en.`);
