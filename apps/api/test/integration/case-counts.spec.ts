import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { summarizeCounts } from '../../src/modules/cases/domain/case-rules';
import { CasesRepository } from '../../src/modules/cases/infrastructure/cases.repository';
import { runMigrations } from '../../src/shared/db/migrator';
import * as schema from '../../src/shared/db/schema';
import { startPostgres, testConfig } from '../support/database';

jest.setTimeout(120_000);

/** S1: the grouped count query on PostgreSQL 16, compared with the list for every status. */
describe('case counts per status (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  const repo = new CasesRepository();
  let doctorA = 0;
  let doctorB = 0;
  let caseNo = 1;
  const TODAY = '2026-11-10';

  const insertCase = (doctorId: number, status: string, expectedDate: string, patientName = 'P') =>
    pool.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, status, delivered_date)
       VALUES ($1, $2, $3, '2026-11-01', $4, $5, $6)`,
      [caseNo++, doctorId, patientName, expectedDate, status, status === 'delivered' ? '2026-11-02' : null],
    );

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool, testConfig(container.getConnectionUri()).migrationsDir);
    const ins = async (name: string) =>
      Number(
        (await pool.query<{ id: string }>(`INSERT INTO doctors (name) VALUES ($1) RETURNING id`, [name]))
          .rows[0]?.id,
      );
    doctorA = await ins('Dr A');
    doctorB = await ins('Dr B');
    // Doctor A: overdue only where the expected date is before today and the case is in the lab.
    await insertCase(doctorA, 'waiting', '2026-11-09'); // overdue
    await insertCase(doctorA, 'design', TODAY); // due today: not overdue
    await insertCase(doctorA, 'in_progress', '2026-11-01', 'Haddad'); // overdue
    await insertCase(doctorA, 'returned', '2026-11-05'); // overdue (back in the lab)
    await insertCase(doctorA, 'delivered', '2026-11-01'); // delivered: never overdue
    await insertCase(doctorA, 'cancelled', '2026-11-01'); // cancelled: never overdue
    await insertCase(doctorB, 'design', '2026-11-20');
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('counts every status and the overdue ones in one grouped statement', async () => {
    const db = drizzle(pool, { schema });
    const all = summarizeCounts(await repo.countByStatus(db, {}, TODAY));
    expect(all.byStatus).toEqual({
      waiting: 1,
      design: 2,
      in_progress: 1,
      ready: 0,
      delivered: 1,
      returned: 1,
      cancelled: 1,
    });
    expect(all.total).toBe(7);
    expect(all.overdue).toBe(3);
  });

  it('applies the list filters (doctor, overdue, search) and matches the list totals', async () => {
    const db = drizzle(pool, { schema });
    const a = summarizeCounts(await repo.countByStatus(db, { doctorId: doctorA }, TODAY));
    expect(a.total).toBe(6);
    const overdueOnly = summarizeCounts(await repo.countByStatus(db, { overdue: true }, TODAY));
    expect(overdueOnly.total).toBe(3);
    expect(overdueOnly.byStatus).toMatchObject({ waiting: 1, in_progress: 1, returned: 1 });
    const searched = summarizeCounts(await repo.countByStatus(db, { search: 'hadd' }, TODAY));
    expect(searched.total).toBe(1);

    for (const status of [
      'waiting',
      'design',
      'in_progress',
      'ready',
      'delivered',
      'returned',
      'cancelled',
    ] as const) {
      const listed = await repo.list(db, { doctorId: doctorA, status, page: 1, pageSize: 1 }, TODAY);
      expect(listed.total).toBe(a.byStatus[status]);
    }
  });

  it('moves the overdue boundary with the lab’s today', async () => {
    const db = drizzle(pool, { schema });
    const tomorrow = summarizeCounts(await repo.countByStatus(db, {}, '2026-11-11'));
    // The design case due on the 10th becomes overdue on the 11th.
    expect(tomorrow.overdue).toBe(4);
  });
});
