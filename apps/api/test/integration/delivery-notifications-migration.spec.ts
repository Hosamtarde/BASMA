import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DatabaseError, Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

jest.setTimeout(180_000);

async function pgError(promise: Promise<unknown>): Promise<{ code?: string; constraint?: string } | undefined> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DatabaseError) return { code: e.code, constraint: e.constraint };
    throw e;
  }
  return undefined;
}

/**
 * B5 migration 0008 (docs/plans/b5-delivery-notifications-backlog.md §6): `cases.collect_on` with its
 * CHECK and partial index, the per-user `notification_states` table and the `notifications.read`
 * permission. Expand-only: existing rows are untouched and already satisfy the new CHECK.
 */
describe('B5 migration 0008 — delivery and notifications (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migrationsDir: string;
  let doctorId: number;
  let userId: number;

  const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
    const cols = Object.keys(row);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return Number(res.rows[0]?.id);
  };
  let caseNo = 0;
  const newCase = (fields: Record<string, unknown> = {}) =>
    insert('cases', {
      case_no: ++caseNo,
      doctor_id: doctorId,
      patient_name: 'P',
      received_date: '2026-11-01',
      expected_date: '2026-11-05',
      status: 'design',
      ...fields,
    });

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    migrationsDir = testConfig(container.getConnectionUri()).migrationsDir;
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('upgrades 0007 with data: cases untouched, collect_on null everywhere, the CHECK holds', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 8));
    doctorId = await insert('doctors', { name: 'Dr Keep', opening_balance: 0 });
    userId = await insert('users', { username: 'keeper', password_hash: 'x' });
    await newCase();
    await newCase({ status: 'delivered', delivered_date: '2026-11-03' });
    await newCase({ status: 'returned' });
    await newCase({ status: 'cancelled' });
    const before = await pool.query('SELECT * FROM cases ORDER BY id');

    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);

    const after = await pool.query<Record<string, unknown>>('SELECT * FROM cases ORDER BY id');
    expect(after.rows.map(({ collect_on, ...rest }) => ({ rest, collect_on }))).toEqual(
      before.rows.map((rest) => ({ rest, collect_on: null })),
    );
    const invalid = await pool.query(`SELECT conname FROM pg_constraint WHERE NOT convalidated`);
    expect(invalid.rows).toEqual([]);
  });

  it('grants notifications.read to the owner', async () => {
    const codes = await pool.query<{ code: string }>(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner' AND rp.permission_code = 'notifications.read'`,
    );
    expect(codes.rows).toEqual([{ code: 'notifications.read' }]);
  });

  describe('cases_collect_on_ck', () => {
    it('accepts a collect date on a delivered case, on or after the delivery date', async () => {
      await newCase({ status: 'delivered', delivered_date: '2026-11-03', collect_on: '2026-11-03' });
      await newCase({ status: 'delivered', delivered_date: '2026-11-03', collect_on: '2026-12-01' });
    });

    it.each([
      ['a case still in the lab', { status: 'ready' }],
      ['a returned case', { status: 'returned' }],
      ['a cancelled case', { status: 'cancelled' }],
      ['a date before delivery', { status: 'delivered', delivered_date: '2026-11-03' }],
    ])('refuses %s', async (_l, fields) => {
      expect(await pgError(newCase({ collect_on: '2026-11-02', ...fields }))).toEqual({
        code: '23514',
        constraint: 'cases_collect_on_ck',
      });
    });

    it('refuses leaving delivered while a collect date is still set', async () => {
      const id = await newCase({ status: 'delivered', delivered_date: '2026-11-03', collect_on: '2026-11-10' });
      expect(
        await pgError(pool.query(`UPDATE cases SET status = 'returned', delivered_date = NULL WHERE id = $1`, [id])),
      ).toEqual({ code: '23514', constraint: 'cases_collect_on_ck' });
    });

    it('the collect query uses the partial index', async () => {
      await pool.query('SET enable_seqscan = off');
      try {
        const plan = await pool.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT id FROM cases WHERE collect_on IS NOT NULL AND collect_on <= '2026-11-10'`,
        );
        expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('cases_collect_on_ix');
      } finally {
        await pool.query('RESET enable_seqscan');
      }
    });
  });

  describe('notification_states', () => {
    it('one row per user and key; keys are 1–100 characters', async () => {
      await pool.query(`INSERT INTO notification_states (user_id, key, seen_at) VALUES ($1, 'case_due:1:soon:2026-11-05', now())`, [userId]);
      expect(
        await pgError(pool.query(`INSERT INTO notification_states (user_id, key) VALUES ($1, 'case_due:1:soon:2026-11-05')`, [userId])),
      ).toEqual({ code: '23505', constraint: 'notification_states_user_id_key_pk' });
      expect(await pgError(pool.query(`INSERT INTO notification_states (user_id, key) VALUES ($1, '')`, [userId]))).toEqual({
        code: '23514',
        constraint: 'notification_states_key_length_ck',
      });
      expect(
        await pgError(pool.query(`INSERT INTO notification_states (user_id, key) VALUES ($1, $2)`, [userId, 'k'.repeat(101)])),
      ).toEqual({ code: '23514', constraint: 'notification_states_key_length_ck' });
    });

    it('is deleted with its user (not financial data)', async () => {
      const other = await insert('users', { username: 'temp', password_hash: 'x' });
      await pool.query(`INSERT INTO notification_states (user_id, key) VALUES ($1, 'x')`, [other]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [other]);
      const left = await pool.query(`SELECT count(*)::int AS n FROM notification_states WHERE user_id = $1`, [other]);
      expect(left.rows[0]).toEqual({ n: 0 });
    });
  });

  it('also works on an empty database (all migrations at once)', async () => {
    const c = await startPostgres();
    const p = new Pool({ connectionString: c.getConnectionUri() });
    try {
      await runMigrations(p, migrationsDir);
      const res = await p.query(`SELECT code FROM permissions WHERE code = 'notifications.read'`);
      expect(res.rows).toEqual([{ code: 'notifications.read' }]);
    } finally {
      await p.end();
      await c.stop();
    }
  });
});
