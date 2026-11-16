import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DatabaseError, Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import * as schema from '../../src/shared/db/schema';
import {
  CHEQUE_STATUSES,
  isCounted,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../../src/modules/payments/domain/payment-rules';
import { LedgerRepository } from '../../src/modules/payments/infrastructure/ledger.repository';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

jest.setTimeout(180_000);

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DatabaseError) return e.code;
    throw e;
  }
  return undefined;
}

describe('B3 payments migration (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migrationsDir: string;
  let doctorId: number;
  let voucher = 0;

  const insertPayment = async (fields: Record<string, unknown> = {}): Promise<number> => {
    const row = {
      voucher_no: ++voucher,
      doctor_id: doctorId,
      method: 'cash',
      amount: 100,
      currency_code: 'ILS',
      paid_at: '2026-11-01',
      ...fields,
    };
    const cols = Object.keys(row);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO payments (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return Number(res.rows[0]?.id);
  };
  const insertCheque = (paymentId: number, fields: Record<string, unknown> = {}) => {
    const row = {
      payment_id: paymentId,
      cheque_no: `N${paymentId}`,
      bank: 'B',
      due_date: '2026-12-01',
      ...fields,
    };
    const cols = Object.keys(row);
    return pool.query(
      `INSERT INTO cheques (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
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

  it('applies on top of 0003 with data, leaving existing rows untouched', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 4));
    const d = await pool.query<{ id: string }>(
      `INSERT INTO doctors (name, opening_balance) VALUES ('Dr Existing', 1234) RETURNING id`,
    );
    doctorId = Number(d.rows[0]?.id);
    await pool.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, status, total)
       VALUES (7, $1, 'P', '2026-11-01', '2026-11-05', 'design', 500)`,
      [doctorId],
    );
    const before = await pool.query('SELECT * FROM cases');
    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);
    // Later migrations may add columns (0006: the generated search column): every old value is unchanged.
    const after = await pool.query<Record<string, unknown>>('SELECT * FROM cases');
    const stripped = after.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'patient_search')));
    expect(stripped).toEqual(before.rows);
    expect((await pool.query('SELECT opening_balance FROM doctors')).rows[0]).toEqual({
      opening_balance: '1234',
    });
  });

  it('seeds the voucher counter at 1 and grants the new permissions to the owner', async () => {
    const counter = await pool.query(
      `SELECT start_value, next_value FROM counters WHERE name = 'payment_in_no'`,
    );
    expect(counter.rows).toEqual([{ start_value: '1', next_value: '1' }]);
    // setup creates the owner role in the real flow; here the role comes from the earlier migrations.
    const granted = await pool.query<{ code: string }>(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner'`,
    );
    for (const code of [
      'payments.read',
      'payments.write',
      'payments.void',
      'cheques.read',
      'cheques.write',
      'ledger.read',
    ]) {
      expect(granted.rows.map((r) => r.code)).toContain(code);
    }
  });

  it.each([
    ['amount 0', { amount: 0 }],
    ['negative amount', { amount: -1 }],
    ['amount above the limit', { amount: 1_000_000_000_000 }],
    ['unknown method', { method: 'card' }],
    ['unknown status', { status: 'deleted' }],
    ['voucher 0', { voucher_no: 0 }],
    ['void without voided_at', { status: 'void', void_reason: 'x' }],
    ['active with a void reason', { void_reason: 'x' }],
    ['void without a reason', { status: 'void', voided_at: '2026-11-01T00:00:00Z' }],
    ['key without hash', { idempotency_key: '11111111-1111-4111-8111-111111111111' }],
    ['empty currency code', { currency_code: '' }],
  ])('refuses a payment with %s', async (_name, fields) => {
    expect(await pgErrorCode(insertPayment(fields))).toBe('23514');
  });

  it('refuses duplicate vouchers and duplicate idempotency keys, and unknown doctors', async () => {
    const id = await insertPayment({
      idempotency_key: '22222222-2222-4222-8222-222222222222',
      request_hash: 'h',
    });
    const v = (
      await pool.query<{ voucher_no: string }>('SELECT voucher_no FROM payments WHERE id = $1', [id])
    ).rows[0];
    expect(await pgErrorCode(insertPayment({ voucher_no: Number(v?.voucher_no) }))).toBe('23505');
    expect(
      await pgErrorCode(
        insertPayment({ idempotency_key: '22222222-2222-4222-8222-222222222222', request_hash: 'h2' }),
      ),
    ).toBe('23505');
    expect(await pgErrorCode(insertPayment({ doctor_id: 999_999 }))).toBe('23503');
    expect(await pgErrorCode(insertPayment({ case_id: 999_999 }))).toBe('23503');
  });

  it('allows many payments without a key, and never deletes a doctor or case that has payments', async () => {
    await insertPayment();
    await insertPayment();
    expect(await pgErrorCode(pool.query('DELETE FROM doctors WHERE id = $1', [doctorId]))).toBe('23503');
    const caseId = Number((await pool.query<{ id: string }>('SELECT id FROM cases LIMIT 1')).rows[0]?.id);
    await insertPayment({ case_id: caseId });
    expect(await pgErrorCode(pool.query('DELETE FROM cases'))).toBe('23503');
  });

  it('cheques: one per payment, status and status date agree, lengths checked, never cascade-deleted', async () => {
    const p = await insertPayment({ method: 'cheque' });
    await insertCheque(p);
    expect(await pgErrorCode(insertCheque(p, { cheque_no: 'second' }))).toBe('23505');
    const p2 = await insertPayment({ method: 'cheque' });
    expect(await pgErrorCode(insertCheque(p2, { status: 'cleared' }))).toBe('23514'); // cleared needs a date
    expect(await pgErrorCode(insertCheque(p2, { status: 'pending', status_date: '2026-11-02' }))).toBe(
      '23514',
    );
    expect(await pgErrorCode(insertCheque(p2, { status: 'bounced', status_date: '2026-11-02' }))).toBe(
      '23514',
    );
    expect(await pgErrorCode(insertCheque(p2, { cheque_no: '' }))).toBe('23514');
    expect(await pgErrorCode(insertCheque(p2, { bank: 'x'.repeat(61) }))).toBe('23514');
    await insertCheque(p2, { status: 'cleared', status_date: '2026-11-02' });
    expect(await pgErrorCode(pool.query('DELETE FROM payments WHERE id = $1', [p]))).toBe('23503');
  });

  it('SQL "counted" equals isCounted() over the whole status × method × cheque-status matrix', async () => {
    const d = await pool.query<{ id: string }>(
      `INSERT INTO doctors (name) VALUES ('Dr Matrix') RETURNING id`,
    );
    const matrixDoctor = Number(d.rows[0]?.id);
    let expected = 0;
    let amount = 1;
    for (const status of PAYMENT_STATUSES) {
      for (const method of PAYMENT_METHODS) {
        for (const chequeStatus of method === 'cheque' ? CHEQUE_STATUSES : [null]) {
          amount *= 2; // distinct powers of two: the sum identifies exactly which rows counted
          const pid = await insertPayment({
            doctor_id: matrixDoctor,
            method,
            amount,
            ...(status === 'void'
              ? { status: 'void', void_reason: 'x', voided_at: '2026-11-02T00:00:00Z' }
              : {}),
          });
          if (method === 'cheque') {
            await insertCheque(pid, {
              status: chequeStatus,
              status_date: chequeStatus === 'pending' ? null : '2026-11-02',
            });
          }
          if (isCounted({ status, method, chequeStatus })) expected += amount;
        }
      }
    }
    const repo = new LedgerRepository();
    const db = drizzle(pool, { schema });
    const input = await repo.doctorInput(db, matrixDoctor);
    expect(input?.counted.reduce((s, p) => s + p.amount, 0)).toBe(expected);
    // The aggregate used by debts and Home agrees too.
    const debts = await repo.debts(db, { direction: 'all', offset: 0, limit: 100 });
    expect(debts.rows.find((r) => r.doctorId === matrixDoctor)?.balance).toBe(-expected);
  });

  it('keeps the money queries on indexes at scale (50 000 payments, 20 000 cases)', async () => {
    const d = await pool.query<{ id: string }>(`INSERT INTO doctors (name) VALUES ('Dr Scale') RETURNING id`);
    const scaleDoctor = Number(d.rows[0]?.id);
    await pool.query(`INSERT INTO doctors (name) SELECT 'Scale ' || g FROM generate_series(1, 300) g`);
    await pool.query(
      `INSERT INTO cases (case_no, doctor_id, patient_name, received_date, expected_date, status, total)
       SELECT 1000 + g, (SELECT id FROM doctors ORDER BY id OFFSET (g % 300) LIMIT 1), 'P',
              DATE '2026-01-01' + (g % 300), DATE '2026-12-31', 'design', 1000 + g
       FROM generate_series(1, 20000) g`,
    );
    await pool.query(
      `INSERT INTO payments (voucher_no, doctor_id, method, amount, currency_code, paid_at)
       SELECT 100000 + g, (SELECT id FROM doctors ORDER BY id OFFSET (g % 300) LIMIT 1),
              CASE WHEN g % 3 = 0 THEN 'cash' WHEN g % 3 = 1 THEN 'transfer' ELSE 'cheque' END,
              500 + (g % 900), 'ILS', DATE '2026-01-01' + (g % 300)
       FROM generate_series(1, 50000) g`,
    );
    await pool.query(
      `INSERT INTO cheques (payment_id, cheque_no, bank, due_date, status, status_date)
       SELECT id, 'S' || id, 'B', DATE '2026-12-01',
              CASE WHEN id % 2 = 0 THEN 'cleared' ELSE 'pending' END,
              CASE WHEN id % 2 = 0 THEN DATE '2026-11-01' END
       FROM payments p0 WHERE method = 'cheque'
         AND NOT EXISTS (SELECT 1 FROM cheques c0 WHERE c0.payment_id = p0.id)`,
    );
    await pool.query('ANALYZE');
    const explain = async (sql: string) =>
      (await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`)).rows
        .map((r) => r['QUERY PLAN'])
        .join('\n');

    // One doctor's payments: the (doctor_id, paid_at) index, not a scan of 50 000 rows.
    const byDoctor = await explain(
      `SELECT * FROM payments WHERE doctor_id = ${scaleDoctor} ORDER BY paid_at DESC, id DESC LIMIT 25`,
    );
    expect(byDoctor).toMatch(/payments_doctor_paid_ix/);
    // The register by status and due date.
    const register = await explain(
      `SELECT * FROM cheques WHERE status = 'pending' AND due_date <= DATE '2026-12-01' ORDER BY due_date LIMIT 25`,
    );
    expect(register).toMatch(/cheques_/);
    // The duplicate check.
    const dup = await explain(`SELECT 1 FROM cheques WHERE lower(bank) = 'b' AND cheque_no = 'S10'`);
    expect(dup).toMatch(/cheques_bank_no_ix/);

    // The debts aggregate stays fast over the full data set.
    const repo = new LedgerRepository();
    const db = drizzle(pool, { schema });
    const started = Date.now();
    await repo.debts(db, { direction: 'all', offset: 0, limit: 25 });
    await repo.summary(db, '2026-11-01', '2026-11-10', '2026-11-17');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
