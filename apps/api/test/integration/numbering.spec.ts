import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { SettingsService } from '../../src/modules/settings/application/settings.service';
import { SettingsRepository } from '../../src/modules/settings/infrastructure/settings.repository';
import { AuditWriter } from '../../src/shared/audit/audit-writer';
import { runMigrations } from '../../src/shared/db/migrator';
import * as schema from '../../src/shared/db/schema';
import { DomainError } from '../../src/shared/errors/domain-error';
import { startPostgres, testConfig } from '../support/database';

jest.setTimeout(120_000);

describe('numbering start (addition C, PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let service: SettingsService;
  let userId: number;

  const counter = async (name: string) => {
    const { rows } = await pool.query<{ start_value: string; next_value: string }>(
      `SELECT start_value, next_value FROM counters WHERE name = $1`,
      [name],
    );
    return { start: Number(rows[0]?.start_value), next: Number(rows[0]?.next_value) };
  };

  /** Stand-in for B2's number issuing: row lock, then increment. */
  const issueNumber = async (name: string) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT next_value FROM counters WHERE name = $1 FOR UPDATE`, [name]);
      await client.query(`UPDATE counters SET next_value = next_value + 1 WHERE name = $1`, [name]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  };

  const reset = (name: string) =>
    pool.query(`UPDATE counters SET start_value = 1, next_value = 1 WHERE name = $1`, [name]);

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool, testConfig(container.getConnectionUri()).migrationsDir);
    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (username, password_hash) VALUES ('owner', 'x') RETURNING id`,
    );
    userId = Number(u.rows[0]?.id);
    service = new SettingsService(drizzle(pool, { schema }), new SettingsRepository(), new AuditWriter());
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('moves next_value with start_value in the same transaction, and audits it', async () => {
    await service.updateNumbering({ case_no: 1001 }, userId);
    expect(await counter('case_no')).toEqual({ start: 1001, next: 1001 });
    await service.updateNumbering({ case_no: 50 }, userId);
    expect(await counter('case_no')).toEqual({ start: 50, next: 50 });

    const { rows } = await pool.query<{ params: Record<string, unknown> }>(
      `SELECT params FROM audit_log WHERE action = 'settings.numbering_updated' ORDER BY id`,
    );
    expect(rows.map((r) => [r.params.startOld, r.params.startNew])).toEqual([
      [1, 1001],
      [1001, 50],
    ]);
  });

  it('refuses a change once a number was issued and leaves the counter untouched', async () => {
    await issueNumber('case_no');
    await expect(service.updateNumbering({ case_no: 9000 }, userId)).rejects.toMatchObject({
      code: 'error.settings.numbering_locked',
      params: { counter: 'case_no' },
    });
    expect(await counter('case_no')).toEqual({ start: 50, next: 51 });
  });

  it('is all-or-nothing across counters', async () => {
    await expect(service.updateNumbering({ case_no: 7, invoice_no: 700 }, userId)).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(await counter('invoice_no')).toEqual({ start: 1, next: 1 });
  });

  it('a concurrent change and issue never leave next_value below start_value or lose a number', async () => {
    for (let round = 0; round < 10; round++) {
      await reset('invoice_no');
      const [change] = await Promise.allSettled([
        service.updateNumbering({ invoice_no: 500 }, userId),
        issueNumber('invoice_no'),
      ]);
      const after = await counter('invoice_no');
      if (change.status === 'fulfilled') {
        // Start changed first, then one number was issued from the new start.
        expect(after).toEqual({ start: 500, next: 501 });
      } else {
        // The issue came first: change refused, counter untouched by it.
        expect(change.reason).toMatchObject({ code: 'error.settings.numbering_locked' });
        expect(after).toEqual({ start: 1, next: 2 });
      }
    }
  });
});
