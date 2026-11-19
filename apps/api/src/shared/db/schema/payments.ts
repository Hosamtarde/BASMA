import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cases } from './cases';
import { expenseCategories } from './catalog';
import { aggregateColumns, amountColumn, idColumn, MAX_AMOUNT_MINOR } from './columns';
import { doctors } from './doctors';
import { users } from './identity';

const MAX = sql.raw(String(MAX_AMOUNT_MINOR));

/**
 * Incoming payments from doctors (SPEC §5.8, §7.4, §8). Never deleted: `status = 'void'` with a reason.
 * Balances are never stored; "counted" is derived (cash/transfer immediately, cheque once cleared).
 */
export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    /** Gap-free number from the counters row `payment_in_no`; shown as IN-000001. */
    voucherNo: bigint('voucher_no', { mode: 'number' }).notNull(),
    doctorId: bigint('doctor_id', { mode: 'number' })
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    caseId: bigint('case_id', { mode: 'number' }).references(() => cases.id, { onDelete: 'restrict' }),
    method: text('method').notNull(),
    amount: amountColumn('amount').notNull(),
    /** Snapshot of the installation's currency code (locked once any payment exists). */
    currencyCode: text('currency_code').notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key'),
    requestHash: text('request_hash'),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('payments_voucher_no_uq').on(t.voucherNo),
    uniqueIndex('payments_idempotency_key_uq').on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    // Doctor payments, statement and balance.
    index('payments_doctor_paid_ix').on(t.doctorId, t.paidAt.desc(), t.id.desc()),
    // Payments list and month totals.
    index('payments_paid_ix').on(t.paidAt.desc(), t.id.desc()),
    // Case panel and the bound-payment sum.
    index('payments_case_ix').on(t.caseId).where(sql`${t.caseId} is not null`),
    check('payments_voucher_no_ck', sql`${t.voucherNo} > 0`),
    check('payments_method_ck', sql`${t.method} in ('cash','cheque','transfer')`),
    check('payments_amount_ck', sql`${t.amount} > 0 and ${t.amount} <= ${MAX}`),
    check('payments_currency_code_length_ck', sql`char_length(${t.currencyCode}) between 1 and 10`),
    check('payments_notes_length_ck', sql`char_length(${t.notes}) <= 500`),
    check('payments_status_ck', sql`${t.status} in ('active','void')`),
    check(
      'payments_void_ck',
      sql`(${t.status} = 'void') = (${t.voidedAt} is not null)
          and (${t.status} = 'void') = (${t.voidReason} is not null)
          and (${t.voidReason} is null or char_length(${t.voidReason}) between 1 and 300)`,
    ),
    check('payments_idempotency_ck', sql`(${t.idempotencyKey} is null) = (${t.requestHash} is null)`),
    check('payments_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

/**
 * Outgoing money (B4b, SPEC §5.9): expenses and refunds to doctors. A separate table so that no query of
 * the incoming ledger can ever count it (docs/plans/b4b-outgoing-expenses.md §1.1). Never deleted.
 * `kind` copies the category's `is_doctor` flag (set only at first run, never changed), so the ledger
 * reads refunds without joining the categories.
 */
export const outgoingPayments = pgTable(
  'outgoing_payments',
  {
    id: idColumn(),
    /** Gap-free number from the counters row `payment_out_no`; shown as OUT-000001. */
    voucherNo: bigint('voucher_no', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    /** Refunds only. */
    doctorId: bigint('doctor_id', { mode: 'number' }).references(() => doctors.id, { onDelete: 'restrict' }),
    /** Expenses only (free text, SPEC §5.9). */
    payee: text('payee'),
    method: text('method').notNull(),
    amount: amountColumn('amount').notNull(),
    currencyCode: text('currency_code').notNull(),
    paidAt: date('paid_at', { mode: 'string' }).notNull(),
    notes: text('notes'),
    status: text('status').notNull().default('active'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key'),
    requestHash: text('request_hash'),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('outgoing_payments_voucher_no_uq').on(t.voucherNo),
    uniqueIndex('outgoing_payments_idempotency_key_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // The list and the month figures.
    index('outgoing_payments_paid_ix').on(t.paidAt.desc(), t.id.desc()),
    // Category filter and the per-category summary.
    index('outgoing_payments_category_ix').on(t.categoryId, t.paidAt.desc()),
    // Refunds in the balance, statement and breakdown.
    index('outgoing_payments_doctor_ix')
      .on(t.doctorId, t.paidAt.desc(), t.id.desc())
      .where(sql`${t.doctorId} is not null`),
    check('outgoing_payments_voucher_no_ck', sql`${t.voucherNo} > 0`),
    check('outgoing_payments_kind_ck', sql`${t.kind} in ('expense','doctor_refund')`),
    check(
      'outgoing_payments_party_ck',
      sql`(${t.kind} = 'doctor_refund') = (${t.doctorId} is not null)
          and (${t.kind} = 'expense') = (${t.payee} is not null)`,
    ),
    check('outgoing_payments_payee_length_ck', sql`char_length(${t.payee}) between 1 and 100`),
    check('outgoing_payments_method_ck', sql`${t.method} in ('cash','cheque','transfer')`),
    check('outgoing_payments_amount_ck', sql`${t.amount} > 0 and ${t.amount} <= ${MAX}`),
    check('outgoing_payments_currency_code_length_ck', sql`char_length(${t.currencyCode}) between 1 and 10`),
    check('outgoing_payments_notes_length_ck', sql`char_length(${t.notes}) <= 500`),
    check('outgoing_payments_status_ck', sql`${t.status} in ('active','void')`),
    check(
      'outgoing_payments_void_ck',
      sql`(${t.status} = 'void') = (${t.voidedAt} is not null)
          and (${t.status} = 'void') = (${t.voidReason} is not null)
          and (${t.voidReason} is null or char_length(${t.voidReason}) between 1 and 300)`,
    ),
    check('outgoing_payments_idempotency_ck', sql`(${t.idempotencyKey} is null) = (${t.requestHash} is null)`),
    check('outgoing_payments_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

/**
 * One row per cheque payment (SPEC §8), incoming or outgoing (B4b): exactly one of `payment_id` /
 * `outgoing_payment_id` is set (a CHECK in the database). Status changes only through the register
 * (SPEC §5.13). Every incoming query reaches a cheque through `payments.id`, so it never sees an
 * outgoing one, and the reverse.
 */
export const cheques = pgTable(
  'cheques',
  {
    id: idColumn(),
    paymentId: bigint('payment_id', { mode: 'number' }).references(() => payments.id, { onDelete: 'restrict' }),
    outgoingPaymentId: bigint('outgoing_payment_id', { mode: 'number' }).references(() => outgoingPayments.id, {
      onDelete: 'restrict',
    }),
    chequeNo: text('cheque_no').notNull(),
    bank: text('bank').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('pending'),
    /** Lab-local date the current non-pending status was set. */
    statusDate: date('status_date', { mode: 'string' }),
    rowVersion: aggregateColumns().rowVersion,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('cheques_payment_uq').on(t.paymentId),
    uniqueIndex('cheques_outgoing_payment_uq')
      .on(t.outgoingPaymentId)
      .where(sql`${t.outgoingPaymentId} is not null`),
    check('cheques_owner_ck', sql`(${t.paymentId} is null) <> (${t.outgoingPaymentId} is null)`),
    // Register filters, due within 7 days, overdue.
    index('cheques_status_due_ix').on(t.status, t.dueDate),
    index('cheques_due_ix').on(t.dueDate),
    // Duplicate-cheque check.
    index('cheques_bank_no_ix').on(sql`lower(${t.bank})`, t.chequeNo),
    check('cheques_cheque_no_length_ck', sql`char_length(${t.chequeNo}) between 1 and 30`),
    check('cheques_bank_length_ck', sql`char_length(${t.bank}) between 1 and 60`),
    check('cheques_status_ck', sql`${t.status} in ('pending','cleared','returned')`),
    check('cheques_status_date_ck', sql`(${t.status} = 'pending') = (${t.statusDate} is null)`),
    check('cheques_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

/** Every cheque transition, so the statement knows when a cheque cleared even after it returned. */
export const chequeStatusHistory = pgTable(
  'cheque_status_history',
  {
    id: idColumn(),
    chequeId: bigint('cheque_id', { mode: 'number' })
      .notNull()
      .references(() => cheques.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    statusDate: date('status_date', { mode: 'string' }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('cheque_status_history_cheque_ix').on(t.chequeId, t.at),
    check(
      'cheque_status_history_from_ck',
      sql`${t.fromStatus} is null or ${t.fromStatus} in ('pending','cleared','returned')`,
    ),
    check('cheque_status_history_to_ck', sql`${t.toStatus} in ('pending','cleared','returned')`),
    check('cheque_status_history_note_length_ck', sql`char_length(${t.note}) <= 300`),
  ],
);
