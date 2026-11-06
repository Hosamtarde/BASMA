import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Arbitrary constant: only one process may migrate at a time (API start vs. installer). */
const MIGRATION_LOCK_KEY = 4_310_001;

/**
 * Applies pending migrations in one transaction under a PostgreSQL advisory lock.
 * Forward-only. The installer takes a backup before calling this (B7).
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), { migrationsFolder: migrationsDir });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export interface MigrationStatus {
  expected: number;
  applied: number;
  current: boolean;
}

/** Compares the migrations shipped with this build with those recorded in the database. */
export async function getMigrationStatus(pool: Pool, migrationsDir: string): Promise<MigrationStatus> {
  const journalRaw = await readFile(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(journalRaw) as { entries: unknown[] };
  const expected = journal.entries.length;

  const exists = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  let applied = 0;
  if (exists.rows[0]?.present) {
    const res = await pool.query<{ n: string }>('SELECT count(*) AS n FROM drizzle.__drizzle_migrations');
    applied = Number(res.rows[0]?.n ?? 0);
  }
  return { expected, applied, current: applied === expected };
}
