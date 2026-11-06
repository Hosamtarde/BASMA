import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DatabaseError, Pool } from 'pg';
import { AuditWriter } from '../../src/shared/audit/audit-writer';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import * as schema from '../../src/shared/db/schema';
import { startPostgres, testConfig } from '../support/database';

jest.setTimeout(120_000);

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DatabaseError) return e.code;
    throw e;
  }
  return undefined;
}

describe('migrations and schema (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migrationsDir: string;

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    migrationsDir = testConfig(container.getConnectionUri()).migrationsDir;
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('reports pending migrations on an empty database', async () => {
    const status = await getMigrationStatus(pool, migrationsDir);
    expect(status.applied).toBe(0);
    expect(status.current).toBe(false);
  });

  it('applies all migrations once, even when two processes start together', async () => {
    await Promise.all([runMigrations(pool, migrationsDir), runMigrations(pool, migrationsDir)]);
    await runMigrations(pool, migrationsDir); // re-run is a no-op
    const status = await getMigrationStatus(pool, migrationsDir);
    expect(status.current).toBe(true);
    expect(status.applied).toBe(status.expected);
  });

  it('writes the install marker used to validate restores', async () => {
    const { rows } = await pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM schema_meta ORDER BY key',
    );
    expect(rows.map((r) => r.key)).toEqual(['db_marker', 'product']);
    expect(rows[0]?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[1]?.value).toBe('dental-lab-system');
  });

  it('grants every permission to the owner role', async () => {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner' ORDER BY 1`,
    );
    const all = await pool.query<{ code: string }>('SELECT code FROM permissions ORDER BY 1');
    expect(rows.map((r) => r.code)).toEqual(all.rows.map((r) => r.code));
    expect(rows.map((r) => r.code)).toContain('account.self');
  });

  it('enforces case-insensitive unique usernames and length checks', async () => {
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('Owner1', 'x')`);
    expect(
      await pgErrorCode(pool.query(`INSERT INTO users (username, password_hash) VALUES ('owner1', 'x')`)),
    ).toBe('23505');
    expect(
      await pgErrorCode(pool.query(`INSERT INTO users (username, password_hash) VALUES ('ab', 'x')`)),
    ).toBe('23514');
  });

  it('never cascades: a user referenced by the audit log cannot be deleted', async () => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = 'Owner1'`);
    await pool.query(`INSERT INTO audit_log (user_id, action) VALUES ($1, 'test.action')`, [rows[0]?.id]);
    expect(await pgErrorCode(pool.query(`DELETE FROM users WHERE username = 'Owner1'`))).toBe('23503');
  });

  it('AuditWriter commits and rolls back together with the caller transaction', async () => {
    const db = drizzle(pool, { schema });
    const audit = new AuditWriter();

    await db.transaction(async (tx) => {
      await audit.write(tx, { userId: null, action: 'test.committed', params: { n: 1 } });
    });
    await expect(
      db.transaction(async (tx) => {
        await audit.write(tx, { userId: null, action: 'test.rolled_back' });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    const { rows } = await pool.query<{ action: string; params: unknown }>(
      `SELECT action, params FROM audit_log WHERE action LIKE 'test.%' ORDER BY id`,
    );
    expect(rows).toEqual([
      { action: 'test.action', params: {} },
      { action: 'test.committed', params: { n: 1 } },
    ]);
  });
});
