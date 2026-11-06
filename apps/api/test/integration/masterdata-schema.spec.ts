import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DatabaseError, Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

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

describe('B1 master-data migration (PostgreSQL 16)', () => {
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

  it('upgrades a B0 database that already holds data', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 1));
    await pool.query(`INSERT INTO users (username, password_hash) VALUES ('owner', 'x')`);
    await pool.query(`INSERT INTO audit_log (user_id, action) SELECT id, 'setup.completed' FROM users`);

    await runMigrations(pool, migrationsDir);

    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);
    const users = await pool.query(`SELECT username FROM users`);
    expect(users.rows).toEqual([{ username: 'owner' }]);
    const audit = await pool.query(`SELECT action FROM audit_log`);
    expect(audit.rows).toEqual([{ action: 'setup.completed' }]);
  });

  it('creates the numbering counters, unlocked at 1', async () => {
    const { rows } = await pool.query(`SELECT name, start_value, next_value FROM counters ORDER BY name`);
    expect(rows).toEqual([
      { name: 'case_no', start_value: '1', next_value: '1' },
      { name: 'invoice_no', start_value: '1', next_value: '1' },
    ]);
  });

  it('rejects a next_value below the start value', async () => {
    expect(await pgErrorCode(pool.query(`UPDATE counters SET start_value = 5, next_value = 4`))).toBe(
      '23514',
    );
  });

  it('grants the new permissions to the owner role', async () => {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner' ORDER BY 1`,
    );
    // Later milestones add more; B1's own permissions must all be granted.
    expect(rows.map((r) => r.code)).toEqual(
      expect.arrayContaining([
        'account.self',
        'catalog.read',
        'catalog.write',
        'doctors.read',
        'doctors.write',
        'settings.read',
        'settings.write',
      ]),
    );
  });

  it('enforces case-insensitive unique names on every list', async () => {
    for (const table of ['doctors', 'technicians', 'work_types', 'expense_categories']) {
      await pool.query(`INSERT INTO ${table} (name) VALUES ('Zircon X')`);
      expect(await pgErrorCode(pool.query(`INSERT INTO ${table} (name) VALUES ('zircon x')`))).toBe('23505');
      expect(await pgErrorCode(pool.query(`INSERT INTO ${table} (name) VALUES ('')`))).toBe('23514');
    }
  });

  it('allows only one doctor-refund expense category', async () => {
    await pool.query(`INSERT INTO expense_categories (name, is_doctor) VALUES ('Doctor A', true)`);
    expect(
      await pgErrorCode(
        pool.query(`INSERT INTO expense_categories (name, is_doctor) VALUES ('Doctor B', true)`),
      ),
    ).toBe('23505');
  });

  it('rejects negative and out-of-range money', async () => {
    expect(
      await pgErrorCode(pool.query(`INSERT INTO work_types (name, unit_price) VALUES ('Neg', -1)`)),
    ).toBe('23514');
    expect(
      await pgErrorCode(
        pool.query(`INSERT INTO doctors (name, opening_balance) VALUES ('Big', 1000000000000)`),
      ),
    ).toBe('23514');
    // Opening balance is signed.
    await pool.query(`INSERT INTO doctors (name, opening_balance) VALUES ('Owes nothing', -500)`);
  });

  it('keeps special prices from silently disappearing (RESTRICT)', async () => {
    const d = await pool.query<{ id: string }>(
      `INSERT INTO doctors (name) VALUES ('With price') RETURNING id`,
    );
    const w = await pool.query<{ id: string }>(`INSERT INTO work_types (name) VALUES ('Crown') RETURNING id`);
    await pool.query(`INSERT INTO doctor_prices (doctor_id, work_type_id, price) VALUES ($1, $2, 100)`, [
      d.rows[0]?.id,
      w.rows[0]?.id,
    ]);
    expect(await pgErrorCode(pool.query(`DELETE FROM doctors WHERE id = $1`, [d.rows[0]?.id]))).toBe('23503');
    expect(await pgErrorCode(pool.query(`DELETE FROM work_types WHERE id = $1`, [w.rows[0]?.id]))).toBe(
      '23503',
    );
  });

  it('accepts only a single PNG/JPEG logo row', async () => {
    await pool.query(
      `INSERT INTO lab_logo (content, mime_type, size_bytes, sha256) VALUES ('\\x89'::bytea, 'image/png', 1, 'x')`,
    );
    expect(
      await pgErrorCode(
        pool.query(
          `INSERT INTO lab_logo (id, content, mime_type, size_bytes, sha256) VALUES (2, '\\x89'::bytea, 'image/png', 1, 'x')`,
        ),
      ),
    ).toBe('23514');
    expect(await pgErrorCode(pool.query(`UPDATE lab_logo SET mime_type = 'image/svg+xml'`))).toBe('23514');
  });
});
