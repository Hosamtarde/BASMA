import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

jest.setTimeout(120_000);

describe('F2c lab slogan migration (PostgreSQL 16)', () => {
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

  const profile = async () =>
    (
      await pool.query<{ value: Record<string, unknown>; row_version: number }>(
        `SELECT value, row_version FROM settings WHERE key = 'lab_profile'`,
      )
    ).rows[0];

  it('adds "slogan": null to a B2 lab profile and keeps every other field and the version', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 3));
    const before = {
      nameAr: 'مختبر',
      nameEn: 'Lab',
      phone: '02 222 3333',
      address: null,
      timeZone: 'Asia/Hebron',
    };
    await pool.query(`INSERT INTO settings (key, value) VALUES ('lab_profile', $1)`, [
      JSON.stringify(before),
    ]);

    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);
    expect(await profile()).toEqual({ value: { ...before, slogan: null }, row_version: 1 });
  });

  it('leaves a profile that already has a slogan alone', async () => {
    await pool.query(
      `UPDATE settings SET value = value || '{"slogan": "Precision"}'::jsonb WHERE key = 'lab_profile'`,
    );
    // The statement of 0003 itself, re-run: idempotent.
    await pool.query(
      `UPDATE settings SET value = value || '{"slogan": null}'::jsonb
       WHERE key = 'lab_profile' AND NOT (value ? 'slogan')`,
    );
    expect((await profile())?.value.slogan).toBe('Precision');
  });
});
