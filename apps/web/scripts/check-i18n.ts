/** CLI: fails when the ar/en UI catalogs are out of parity. Usage: npm run i18n:check -w apps/web */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkParity, flatten } from './i18n-parity.ts';
import type { Catalog } from './i18n-parity.ts';

const dir = path.resolve(import.meta.dirname, '../src/i18n');
const load = (lang: string) => JSON.parse(readFileSync(path.join(dir, `${lang}.json`), 'utf8')) as Catalog;
const catalogs = { ar: load('ar'), en: load('en') };

const problems = checkParity(catalogs);
if (problems.length > 0) {
  console.error(`i18n check failed (${problems.length}):\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
const count = Object.keys(flatten(catalogs.ar).keys).length;
console.log(
  `i18n check passed: ${count} ar strings, ${Object.keys(flatten(catalogs.en).keys).length} en strings, same entries and placeholders.`,
);
