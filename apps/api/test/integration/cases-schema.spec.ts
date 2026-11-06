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

describe('B2 cases migration (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migrationsDir: string;
  let doctorId: string;
  let workTypeId: string;
  let caseId: string;

  const insertCase = (fields: Record<string, unknown> = {}) => {
    const row = {
      case_no: Math.floor(Math.random() * 1e9) + 1,
      doctor_id: doctorId,
      patient_name: 'P',
      received_date: '2026-11-01',
      expected_date: '2026-11-05',
      status: 'design',
      ...fields,
    };
    const cols = Object.keys(row);
    return pool.query<{ id: string }>(
      `INSERT INTO cases (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
  };

  const insertItem = (fields: Record<string, unknown>) => {
    const row = {
      case_id: caseId,
      work_type_id: workTypeId,
      work_type_name: 'Crown',
      unit_price: 100,
      price_source: 'general',
      ...fields,
    };
    const cols = Object.keys(row);
    return pool.query(
      `INSERT INTO case_items (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(row),
    );
  };

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    migrationsDir = testConfig(container.getConnectionUri()).migrationsDir;
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('upgrades a B1 database that already holds master data', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 2));
    const d = await pool.query<{ id: string }>(
      `INSERT INTO doctors (name, opening_balance) VALUES ('Dr B1', 500) RETURNING id`,
    );
    const w = await pool.query<{ id: string }>(
      `INSERT INTO work_types (name, unit_price) VALUES ('Crown', 100) RETURNING id`,
    );
    doctorId = d.rows[0]?.id ?? '';
    workTypeId = w.rows[0]?.id ?? '';

    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);
    const kept = await pool.query(`SELECT name, opening_balance FROM doctors`);
    expect(kept.rows).toEqual([{ name: 'Dr B1', opening_balance: '500' }]);
  });

  it('grants the case permissions to the owner', async () => {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner' AND permission_code LIKE 'cases.%' ORDER BY 1`,
    );
    expect(rows.map((r) => r.code)).toEqual(['cases.cancel', 'cases.read', 'cases.write']);
  });

  it('enforces dates, status codes, unique case numbers and non-negative money', async () => {
    const ok = await insertCase({ case_no: 1 });
    caseId = ok.rows[0]?.id ?? '';
    expect(await pgErrorCode(insertCase({ case_no: 1 }))).toBe('23505');
    expect(await pgErrorCode(insertCase({ expected_date: '2026-10-31' }))).toBe('23514');
    expect(await pgErrorCode(insertCase({ status: 'invoiced' }))).toBe('23514');
    expect(await pgErrorCode(insertCase({ discount: -1 }))).toBe('23514');
    expect(await pgErrorCode(insertCase({ patient_name: '' }))).toBe('23514');
  });

  it('keeps delivered_date exactly while delivered and never before received (addition A)', async () => {
    expect(await pgErrorCode(insertCase({ status: 'delivered' }))).toBe('23514');
    expect(await pgErrorCode(insertCase({ status: 'ready', delivered_date: '2026-11-03' }))).toBe('23514');
    expect(await pgErrorCode(insertCase({ status: 'delivered', delivered_date: '2026-10-30' }))).toBe(
      '23514',
    );
    await insertCase({ status: 'delivered', delivered_date: '2026-11-03' });
  });

  it('a line has exactly one of tooth or area (owner decision B2)', async () => {
    await insertItem({ tooth_no: 11 });
    await insertItem({ area: 'upper_arch' });
    await insertItem({ area: 'none' });
    expect(await pgErrorCode(insertItem({}))).toBe('23514');
    expect(await pgErrorCode(insertItem({ tooth_no: 11, area: 'lower_arch' }))).toBe('23514');
    expect(await pgErrorCode(insertItem({ area: 'left_side' }))).toBe('23514');
  });

  it.each([10, 19, 20, 29, 49, 51, 0])('rejects tooth %p (FDI permanent teeth only)', async (tooth) => {
    expect(await pgErrorCode(insertItem({ tooth_no: tooth }))).toBe('23514');
  });

  it('accepts every FDI permanent tooth', async () => {
    for (const quadrant of [1, 2, 3, 4]) {
      for (let unit = 1; unit <= 8; unit++) await insertItem({ tooth_no: quadrant * 10 + unit });
    }
  });

  it('never cascades: cases, doctors, technicians and work types in use cannot be deleted', async () => {
    expect(await pgErrorCode(pool.query(`DELETE FROM cases WHERE id = $1`, [caseId]))).toBe('23503');
    expect(await pgErrorCode(pool.query(`DELETE FROM doctors WHERE id = $1`, [doctorId]))).toBe('23503');
    expect(await pgErrorCode(pool.query(`DELETE FROM work_types WHERE id = $1`, [workTypeId]))).toBe('23503');
  });
});
