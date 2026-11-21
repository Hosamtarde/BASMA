import type { Database, Tx } from './database';

/** `Database.transaction` hands out a `PgTransaction`, which (unlike the pool database) can roll back. */
const isTransaction = (db: Database | Tx): boolean => 'rollback' in db;

type Awaited2<T extends readonly unknown[]> = { -readonly [K in keyof T]: Awaited<T[K]> };

/**
 * Runs independent reads: in parallel on the pool (each takes its own connection), one after the other inside a
 * transaction (it has one connection, and node-postgres reports overlapping queries on it as deprecated, to be
 * removed in pg@9; production-readiness #23). Pass the lazy query builders — they start when awaited.
 */
export async function readAll<const T extends readonly PromiseLike<unknown>[]>(db: Database | Tx, queries: T): Promise<Awaited2<T>> {
  if (!isTransaction(db)) return await Promise.all(queries);
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as Awaited2<T>;
}
