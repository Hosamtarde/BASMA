import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DatabaseError, Pool } from 'pg';
import {
  CHEQUE_STATUSES,
  isCounted,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../../src/modules/payments/domain/payment-rules';
import { LedgerRepository } from '../../src/modules/payments/infrastructure/ledger.repository';
import { PaymentsRepository } from '../../src/modules/payments/infrastructure/payments.repository';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import * as schema from '../../src/shared/db/schema';
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

  describe('ledger reads refunds with the same counted rule (SQL twin of isCounted)', () => {
    it('refunds over the whole status × method × cheque-status matrix: inputs, balance CTE and statement agree', async () => {
      const matrixDoctor = await insert('doctors', { name: 'Dr Refund Matrix', opening_balance: 0 });
      let expectedCounted = 0;
      let expectedPending = 0;
      let amount = 1;
      for (const status of PAYMENT_STATUSES) {
        for (const method of PAYMENT_METHODS) {
          for (const chequeStatus of method === 'cheque' ? CHEQUE_STATUSES : [null]) {
            amount *= 2; // distinct powers of two: the sum names exactly the rows that counted
            const id = await outgoing({
              kind: 'doctor_refund',
              category_id: refundCategory,
              payee: null,
              doctor_id: matrixDoctor,
              method,
              amount,
              ...(status === 'void' ? { status: 'void', void_reason: 'x', voided_at: '2026-11-02T00:00:00Z' } : {}),
            });
            if (method === 'cheque') {
              const chequeId = await cheque({ outgoing_payment_id: id, status: chequeStatus, status_date: chequeStatus === 'pending' ? null : '2026-11-03' }, `M${id}`);
              await pool.query(
                `INSERT INTO cheque_status_history (cheque_id, from_status, to_status, status_date) VALUES ($1, NULL, 'pending', '2026-11-01')`,
                [chequeId],
              );
              if (chequeStatus !== 'pending') {
                await pool.query(
                  `INSERT INTO cheque_status_history (cheque_id, from_status, to_status, status_date) VALUES ($1, 'pending', $2, '2026-11-03')`,
                  [chequeId, chequeStatus],
                );
              }
            }
            if (isCounted({ status, method, chequeStatus })) expectedCounted += amount;
            if (status === 'active' && chequeStatus === 'pending') expectedPending += amount;
          }
        }
      }
      // And an expense of the same size per row: it must change nothing for the doctor.
      await outgoing({ amount: 999 });

      const repo = new LedgerRepository();
      const db = drizzle(pool, { schema });
      const input = await repo.doctorInput(db, matrixDoctor);
      expect(input?.refunds.reduce((s, r) => s + r.amount, 0)).toBe(expectedCounted);
      expect(input?.pendingRefundCheques).toBe(expectedPending);
      expect(input?.counted).toEqual([]);
      // A cleared cheque refund is dated the day it cleared.
      expect(new Set(input?.refunds.map((r) => r.date))).toEqual(new Set(['2026-11-01', '2026-11-03']));
      const debts = await repo.debts(db, { direction: 'all', offset: 0, limit: 100 });
      expect(debts.rows.find((r) => r.doctorId === matrixDoctor)?.balance).toBe(expectedCounted);
      expect((await repo.balancesOf(db, [matrixDoctor])).get(matrixDoctor)?.balance).toBe(expectedCounted);
      const st = await repo.statement(db, matrixDoctor, 0, {}, 0, 100);
      expect(st.periodOpening + st.periodNet).toBe(expectedCounted);
    });
  });

  describe('isolation: incoming reads never see outgoing money, and the reverse', () => {
    it('incoming lists, totals, receipts, register, Home and duplicate check are unchanged by outgoing rows', async () => {
      const repo = new LedgerRepository();
      const pay = new PaymentsRepository();
      const db = drizzle(pool, { schema });
      const iso = await insert('doctors', { name: 'Dr Isolation', opening_balance: 0 });
      const inPay = await insert('payments', {
        voucher_no: ++inVoucher,
        doctor_id: iso,
        method: 'cheque',
        amount: 700,
        currency_code: 'ILS',
        paid_at: '2026-11-01',
      });
      await cheque({ payment_id: inPay, status: 'pending' }, 'ISO-SAME');

      const snapshot = async () => ({
        input: await repo.doctorInput(db, iso),
        debts: await repo.debts(db, { direction: 'all', offset: 0, limit: 500 }),
        summary: await repo.summary(db, '2026-11-01', '2026-11-30', '2026-12-07'),
        list: await pay.list(db, {}, 1, 100),
        receipts: await pay.receiptsSummary(db, {}),
        cheques: await pay.listCheques(db, {}, '2026-11-15', '2026-11-22', 1, 100),
        chequeSummary: await pay.chequeSummary(db, {}, '2026-11-15', '2026-11-22'),
      });
      const before = await snapshot();

      // Outgoing money of every shape, including a cheque with the SAME bank and number as the incoming one.
      const e1 = await outgoing({ method: 'cheque', amount: 12345 });
      await cheque({ outgoing_payment_id: e1, status: 'pending' }, 'ISO-SAME');
      const e2 = await outgoing({ method: 'cheque', amount: 2222 });
      await cheque({ outgoing_payment_id: e2, status: 'cleared', status_date: '2026-11-05' }, 'ISO-2');
      await outgoing({ method: 'cash', amount: 333 });
      await outgoing({ kind: 'expense', method: 'transfer', amount: 444 });

      const after = await snapshot();
      const { summary: s0, ...rest0 } = before;
      const { summary: s1, ...rest1 } = after;
      expect(rest1).toEqual(rest0);
      // Home: every incoming figure is unchanged; only the outgoing figures moved.
      const incomingOf = (s: typeof s0) => ({
        owedToLab: s.owedToLab,
        receivedTotal: s.receivedTotal,
        receivedThisMonth: s.receivedThisMonth,
        pendingChequesCount: s.pendingChequesCount,
        pendingChequesAmount: s.pendingChequesAmount,
        chequesDueSoon: s.chequesDueSoon,
        chequesOverdue: s.chequesOverdue,
      });
      expect(incomingOf(s1)).toEqual(incomingOf(s0));
      expect(s1.outgoingTotal - s0.outgoingTotal).toBe(2222 + 333 + 444);
      // The incoming duplicate check does not collide with the lab's own cheque of the same bank + number.
      const tx = db as never; // each statement is its own transaction here; the advisory lock is released at once
      expect(await pay.chequeDuplicate(tx, 'B', 'ISO-2')).toBe(false);
      expect(await pay.chequeDuplicate(tx, 'B', 'ISO-SAME')).toBe(true); // the incoming one itself
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
