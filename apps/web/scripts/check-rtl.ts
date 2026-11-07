/** CLI: fails on physical (non-RTL-safe) classes or CSS properties in apps/web/src. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { scan } from './rtl-guard.ts';
import type { Finding } from './rtl-guard.ts';

const root = path.resolve(import.meta.dirname, '../src');

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.(test|gen)\.tsx?$/.test(entry.name)) yield full;
  }
}

const findings: Finding[] = [];
let scanned = 0;
for (const file of files(root)) {
  scanned++;
  const rel = path.relative(path.resolve(root, '..'), file).replaceAll('\\', '/');
  findings.push(...scan(rel, readFileSync(file, 'utf8'), file.endsWith('.css') ? 'css' : 'tsx'));
}

if (findings.length > 0) {
  console.error(`RTL guard failed (${findings.length}):`);
  for (const f of findings) console.error(` - ${f.file}:${f.line}  "${f.match}" → ${f.hint}`);
  process.exit(1);
}
console.log(`RTL guard passed: ${scanned} files use logical properties only.`);
