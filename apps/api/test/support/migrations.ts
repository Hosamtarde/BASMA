import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Copy of the migrations folder that contains only the first `count` migrations,
 * to build "previous schema with data" databases (db-migrations skill).
 */
export function migrationsUpTo(migrationsDir: string, count: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'migrations-'));
  cpSync(migrationsDir, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}
