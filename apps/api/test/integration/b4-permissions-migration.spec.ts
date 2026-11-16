import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

jest.setTimeout(120_000);

describe('B4 migration 0005 — exports.run and search.use (PostgreSQL 16)', () => {
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

  const ownerCodes = async (): Promise<string[]> =>
    (
      await pool.query<{ code: string }>(
        `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'owner'`,
      )
    ).rows.map((r) => r.code);

  it('upgrades 0004 with data: existing rows untouched, both permissions granted to the owner, idempotent', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 5));
    expect(await ownerCodes()).not.toContain('exports.run');
    await pool.query(`INSERT INTO doctors (name, opening_balance) VALUES ('Dr Keep', 1234)`);

    await runMigrations(pool, migrationsDir);
    const status = await getMigrationStatus(pool, migrationsDir);
    expect(status.current).toBe(true);

    const codes = await ownerCodes();
    expect(codes).toEqual(expect.arrayContaining(['exports.run', 'search.use', 'ledger.read']));
    const doc = await pool.query(`SELECT name, opening_balance FROM doctors`);
    expect(doc.rows).toEqual([{ name: 'Dr Keep', opening_balance: '1234' }]);
  });

  it('also works on an empty database (all migrations at once)', async () => {
    const c = await startPostgres();
    const p = new Pool({ connectionString: c.getConnectionUri() });
    try {
      await runMigrations(p, migrationsDir);
      const res = await p.query<{ code: string }>(`SELECT code FROM permissions WHERE code IN ('exports.run','search.use') ORDER BY code`);
      expect(res.rows.map((r) => r.code)).toEqual(['exports.run', 'search.use']);
    } finally {
      await p.end();
      await c.stop();
    }
  });
});
