import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import { foldText } from '../../src/shared/text/search-fold';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

jest.setTimeout(180_000);

describe('B4 migration 0006 — folded search columns (PostgreSQL 16)', () => {
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

  it('adds generated columns to existing rows (0005 + data → 0006) and keeps every other value', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 6));
    await pool.query(`INSERT INTO doctors (name, clinic, opening_balance) VALUES ('د. أحمد الهمزة', 'عيادة الفاطمة', 777)`);
    const d = await pool.query<{ id: string }>(`SELECT id FROM doctors`);
    await pool.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, status, total)
       VALUES (1, $1, 'مُحَمَّد فاطِمَة', '2026-11-01', '2026-11-10', 'design', 500)`,
      [d.rows[0]?.id],
    );
    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);
    const doctor = await pool.query(`SELECT name, clinic, opening_balance, search_text FROM doctors`);
    expect(doctor.rows).toEqual([
      { name: 'د. أحمد الهمزة', clinic: 'عيادة الفاطمة', opening_balance: '777', search_text: foldText('د. أحمد الهمزة عيادة الفاطمة') },
    ]);
    const kase = await pool.query(`SELECT patient_name, total, patient_search FROM cases`);
    expect(kase.rows).toEqual([{ patient_name: 'مُحَمَّد فاطِمَة', total: '500', patient_search: foldText('مُحَمَّد فاطِمَة') }]);
  });

  it('the SQL fold equals the TypeScript fold, follows updates and cannot be written directly', async () => {
    const samples = ['أحمد', 'إيمان', 'آمنة', 'فاطمة', 'مصطفى', 'مُحَمَّد', 'مـحـمـد', 'Dr ÉMILE', 'ٱلله', 'بسمة'];
    for (const [i, name] of samples.entries()) {
      await pool.query(`INSERT INTO doctors (name) VALUES ($1)`, [`${name}${i}`]);
    }
    const rows = await pool.query<{ name: string; search_text: string }>(`SELECT name, search_text FROM doctors WHERE name LIKE ANY ($1)`, [
      samples.map((_, i) => `%${i}`),
    ]);
    for (const r of rows.rows) expect({ n: r.name, s: r.search_text }).toEqual({ n: r.name, s: foldText(r.name) });

    await pool.query(`UPDATE doctors SET clinic = 'عيادة الياسمين' WHERE name = 'أحمد0'`);
    const updated = await pool.query(`SELECT search_text FROM doctors WHERE name = 'أحمد0'`);
    expect(updated.rows[0]?.search_text).toBe(foldText('أحمد0 عيادة الياسمين'));
    await expect(pool.query(`UPDATE doctors SET search_text = 'x'`)).rejects.toThrow(/only be updated to DEFAULT/i);
  });

  it('also works on an empty database', async () => {
    const c = await startPostgres();
    const p = new Pool({ connectionString: c.getConnectionUri() });
    try {
      await runMigrations(p, migrationsDir);
      const cols = await p.query(
        `SELECT table_name, column_name, is_generated FROM information_schema.columns
         WHERE column_name IN ('search_text','patient_search') ORDER BY table_name`,
      );
      expect(cols.rows).toEqual([
        { table_name: 'cases', column_name: 'patient_search', is_generated: 'ALWAYS' },
        { table_name: 'doctors', column_name: 'search_text', is_generated: 'ALWAYS' },
      ]);
    } finally {
      await p.end();
      await c.stop();
    }
  });
});
