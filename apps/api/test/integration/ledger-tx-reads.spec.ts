import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { LedgerRepository } from '../../src/modules/payments/infrastructure/ledger.repository';
import { runMigrations } from '../../src/shared/db/migrator';
import * as schema from '../../src/shared/db/schema';
import { startPostgres, testConfig } from '../support/database';

jest.setTimeout(180_000);

/**
 * production-readiness #23 (B6b): the shared ledger reads run inside a transaction (delivery in B5, invoice issue
 * in B6) and must not overlap on its one connection — pg reports that as «client.query() while already
 * executing» and removes support in pg@9. A query that starts while another is still running on the same client
 * is counted here directly (the warning itself is not observable from inside Jest). The reads of a transaction
 * run one after the other; the same reads on the pool still run in parallel (separate connections).
 */
describe('Ledger reads inside a transaction (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let doctorId: number;
  let overlaps = 0;
  const original = Client.prototype.query;

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool, testConfig(container.getConnectionUri()).migrationsDir);
    doctorId = Number(
      (await pool.query<{ id: string }>(`INSERT INTO doctors (name, opening_balance) VALUES ('Dr Tx', 1000) RETURNING id`)).rows[0]!.id,
    );
    await pool.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, status, discount, total)
       VALUES (1, $1, 'P', '2026-11-01', '2026-11-08', 'ready', 0, 5000)`,
      [doctorId],
    );
    // Counts queries that start while the same client still runs one.
    const inflight = new WeakMap<object, number>();
    (Client.prototype as { query: unknown }).query = function patched(this: Client, ...args: unknown[]) {
      const running = inflight.get(this) ?? 0;
      if (running > 0) overlaps += 1;
      inflight.set(this, running + 1);
      const done = () => inflight.set(this, (inflight.get(this) ?? 1) - 1);
      const result = (original as (...a: unknown[]) => unknown).apply(this, args);
      if (result && typeof (result as Promise<unknown>).then === 'function') (result as Promise<unknown>).then(done, done);
      else done();
      return result;
    };
  });
  afterAll(async () => {
    Client.prototype.query = original;
    await pool?.end();
    await container?.stop();
  });

  it('doctorInputs and statement in a transaction never overlap on the connection, and return the same figures as on the pool', async () => {
    const db = drizzle(pool, { schema });
    const repo = new LedgerRepository();
    overlaps = 0;

    const inTx = await db.transaction(async (tx) => {
      const inputs = await repo.doctorInputs(tx, [doctorId]);
      const statement = await repo.statement(tx, doctorId, 1000, {}, 0, 100);
      return { inputs, statement };
    });
    expect(overlaps).toBe(0);

    const onPool = { inputs: await repo.doctorInputs(db, [doctorId]), statement: await repo.statement(db, doctorId, 1000, {}, 0, 100) };
    expect(inTx).toEqual(onPool);
    expect(inTx.inputs.get(doctorId)?.cases).toHaveLength(1);
    expect(inTx.statement.lines).toHaveLength(1);
  });
});
