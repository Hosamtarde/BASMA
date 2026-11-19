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
 * B4b migration 0007 (docs/plans/b4b-outgoing-expenses.md §1): outgoing_payments, the second owner of a
 * cheque with a database CHECK "exactly one owner", the OUT- counter and the expenses permissions.
 */
describe('B4b migration 0007 — outgoing payments (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migrationsDir: string;
  let doctorId: number;
  let expenseCategory: number;
  let refundCategory: number;
  let inVoucher = 0;
  let outVoucher = 0;
  let incomingId: number;

  const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
    const cols = Object.keys(row);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return Number(res.rows[0]?.id);
  };
  const outgoing = (fields: Record<string, unknown> = {}) =>
    insert('outgoing_payments', {
      voucher_no: ++outVoucher,
      kind: 'expense',
      category_id: expenseCategory,
      payee: 'Landlord',
      method: 'cash',
      amount: 100,
      currency_code: 'ILS',
      paid_at: '2026-11-01',
      ...fields,
    });
  const cheque = (owner: Record<string, unknown>, n: string) =>
    insert('cheques', { cheque_no: n, bank: 'B', due_date: '2026-12-01', ...owner });

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    migrationsDir = testConfig(container.getConnectionUri()).migrationsDir;
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('upgrades 0006 with B3/B4 data: incoming payments and cheques untouched and valid', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 7));
    doctorId = await insert('doctors', { name: 'Dr Keep', opening_balance: 0 });
    incomingId = await insert('payments', {
      voucher_no: ++inVoucher,
      doctor_id: doctorId,
      method: 'cheque',
      amount: 5000,
      currency_code: 'ILS',
      paid_at: '2026-11-01',
    });
    await cheque({ payment_id: incomingId }, 'IN-CHQ');
    expenseCategory = await insert('expense_categories', { name: 'Rent', is_doctor: false });
    refundCategory = await insert('expense_categories', { name: 'Doctor (refund)', is_doctor: true });
    const before = await pool.query('SELECT * FROM cheques ORDER BY id');

    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);

    const after = await pool.query<Record<string, unknown>>('SELECT * FROM cheques ORDER BY id');
    expect(after.rows.map(({ outgoing_payment_id, ...rest }) => ({ rest, outgoing_payment_id }))).toEqual(
      before.rows.map((rest) => ({ rest, outgoing_payment_id: null })),
    );
    // Every existing cheque satisfies the new owner rule.
    const valid = await pool.query(
      `SELECT count(*)::int AS n FROM cheques WHERE (payment_id IS NULL) = (outgoing_payment_id IS NULL)`,
    );
    expect(valid.rows[0]).toEqual({ n: 0 });
  });

  it('adds the OUT- counter (start 1) and grants the three expenses permissions to the owner', async () => {
    const counter = await pool.query(
      `SELECT start_value, next_value FROM counters WHERE name = 'payment_out_no'`,
    );
    expect(counter.rows).toEqual([{ start_value: '1', next_value: '1' }]);
    const codes = await pool.query<{ code: string }>(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner' AND rp.permission_code LIKE 'expenses.%' ORDER BY 1`,
    );
    expect(codes.rows.map((r) => r.code)).toEqual(['expenses.read', 'expenses.void', 'expenses.write']);
  });

  describe('cheques: the database enforces exactly one owner', () => {
    it('rejects a cheque with NO owner', async () => {
      expect(await pgError(cheque({}, 'NONE'))).toEqual({ code: '23514', constraint: 'cheques_owner_ck' });
    });

    it('rejects a cheque with TWO owners (an incoming and an outgoing payment)', async () => {
      const out = await outgoing({ method: 'cheque' });
      expect(await pgError(cheque({ payment_id: incomingId, outgoing_payment_id: out }, 'TWO'))).toEqual({
        code: '23514',
        constraint: 'cheques_owner_ck',
      });
      // Also when an update tries to add the second owner to an existing cheque.
      const inPay = await insert('payments', {
        voucher_no: ++inVoucher,
        doctor_id: doctorId,
        method: 'cheque',
        amount: 10,
        currency_code: 'ILS',
        paid_at: '2026-11-01',
      });
      const id = await cheque({ payment_id: inPay }, 'ONE-IN');
      expect(
        await pgError(pool.query(`UPDATE cheques SET outgoing_payment_id = $1 WHERE id = $2`, [out, id])),
      ).toEqual({ code: '23514', constraint: 'cheques_owner_ck' });
      expect(await pgError(pool.query(`UPDATE cheques SET payment_id = NULL WHERE id = $1`, [id]))).toEqual({
        code: '23514',
        constraint: 'cheques_owner_ck',
      });
    });

    it('accepts exactly one owner of either direction, and one cheque per outgoing payment', async () => {
      const out = await outgoing({ method: 'cheque' });
      await expect(cheque({ outgoing_payment_id: out }, 'ONE-OUT')).resolves.toBeGreaterThan(0);
      expect(await pgError(cheque({ outgoing_payment_id: out }, 'ONE-OUT-2'))).toEqual({
        code: '23505',
        constraint: 'cheques_outgoing_payment_uq',
      });
    });
  });

  describe('outgoing_payments constraints', () => {
    it.each([
      ['an expense without a payee', { payee: null }, 'outgoing_payments_party_ck'],
      ['an expense naming a doctor', { doctor_id: 'DOCTOR' }, 'outgoing_payments_party_ck'],
      ['a refund without a doctor', { kind: 'doctor_refund', payee: null }, 'outgoing_payments_party_ck'],
      ['a refund with a payee', { kind: 'doctor_refund', doctor_id: 'DOCTOR' }, 'outgoing_payments_party_ck'],
      ['an empty payee', { payee: '' }, 'outgoing_payments_payee_length_ck'],
      ['a payee over 100 characters', { payee: 'x'.repeat(101) }, 'outgoing_payments_payee_length_ck'],
      ['an unknown kind', { kind: 'salary' }, 'outgoing_payments_kind_ck'],
      ['an unknown method', { method: 'card' }, 'outgoing_payments_method_ck'],
      ['a zero amount', { amount: 0 }, 'outgoing_payments_amount_ck'],
      ['a negative amount', { amount: -5 }, 'outgoing_payments_amount_ck'],
      ['an amount over the limit', { amount: 1_000_000_000_000 }, 'outgoing_payments_amount_ck'],
      ['void without a reason', { status: 'void', voided_at: '2026-11-02T00:00:00Z' }, 'outgoing_payments_void_ck'],
      ['a reason without void', { void_reason: 'x' }, 'outgoing_payments_void_ck'],
      ['a key without a hash', { idempotency_key: '7b7c2f0e-9a49-4c55-8a0f-3f0b0f5a3d2e' }, 'outgoing_payments_idempotency_ck'],
      ['voucher 0', { voucher_no: 0 }, 'outgoing_payments_voucher_no_ck'],
    ])('rejects %s', async (_label, fields, constraint) => {
      const row = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, v === 'DOCTOR' ? doctorId : v]),
      );
      expect(await pgError(outgoing(row))).toEqual({ code: '23514', constraint });
    });

    it('accepts a refund to a doctor and keeps voucher numbers unique', async () => {
      const id = await outgoing({ kind: 'doctor_refund', category_id: refundCategory, payee: null, doctor_id: doctorId });
      expect(id).toBeGreaterThan(0);
      expect(await pgError(outgoing({ voucher_no: 1 }))).toEqual({
        code: '23505',
        constraint: 'outgoing_payments_voucher_no_uq',
      });
    });

    it('never cascades: a used category, doctor or outgoing payment cannot be deleted', async () => {
      expect((await pgError(pool.query(`DELETE FROM expense_categories WHERE id = $1`, [expenseCategory])))?.code).toBe(
        '23503',
      );
      expect((await pgError(pool.query(`DELETE FROM doctors WHERE id = $1`, [doctorId])))?.code).toBe('23503');
      const out = await outgoing({ method: 'cheque' });
      await cheque({ outgoing_payment_id: out }, 'KEEP');
      expect((await pgError(pool.query(`DELETE FROM outgoing_payments WHERE id = $1`, [out])))?.code).toBe('23503');
    });
  });

  it('also works on an empty database (all migrations at once)', async () => {
    const c = await startPostgres();
    const p = new Pool({ connectionString: c.getConnectionUri() });
    try {
      await runMigrations(p, migrationsDir);
      const res = await p.query(`SELECT name FROM counters WHERE name = 'payment_out_no'`);
      expect(res.rows).toEqual([{ name: 'payment_out_no' }]);
      const t = await p.query(`SELECT to_regclass('public.outgoing_payments')::text AS t`);
      expect(t.rows).toEqual([{ t: 'outgoing_payments' }]);
    } finally {
      await p.end();
      await c.stop();
    }
  });
});
