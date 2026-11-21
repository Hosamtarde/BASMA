import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { readAll } from '../../../shared/db/read-all';
import { cases, cheques, doctors, payments } from '../../../shared/db/schema';
import type { CountedPayment, CountedRefund, LedgerCase, PaymentMethod } from '../domain/payment-rules';
import { countedWhere } from './payments.repository';

type Executor = Database | Tx;

/**
 * Raw-SQL twins for outgoing money (B4b), on `outgoing_payments o LEFT JOIN cheques och ON
 * och.outgoing_payment_id = o.id`: counted = active and (not a cheque, or a cleared one) — the same
 * `isCounted` rule as incoming; the effective date is the payment date, or the day a cheque cleared.
 */
export const OUT_COUNTED_SQL = sql`o.status = 'active' AND (o.method <> 'cheque' OR och.status = 'cleared')`;
export const OUT_EFFECTIVE_SQL = sql`(CASE WHEN o.method = 'cheque' THEN och.status_date ELSE o.paid_at END)`;

export interface DoctorLedgerInput {
  doctorId: number;
  doctorName: string;
  opening: number;
  cases: LedgerCase[];
  counted: CountedPayment[];
  /** Counted refunds to the doctor (B4b `paid_out`), on their effective date. */
  refunds: CountedRefund[];
  /** Σ active cheques still pending (shown separately, never reduce dues). */
  pendingCheques: number;
  /** Σ active refund cheques not cleared yet: they reserve the credit (B4b X2). */
  pendingRefundCheques: number;
}

export interface DebtRow {
  doctorId: number;
  name: string;
  active: boolean;
  balance: number;
  pendingCheques: number;
}

export interface DebtSummary {
  parties: number;
  owedToLab: number;
  owedByLab: number;
}

export const STATEMENT_KINDS = ['case', 'payment', 'cheque_return', 'refund', 'refund_cheque_return'] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export interface StatementLine {
  date: string;
  kind: StatementKind;
  refId: number;
  ref: string;
  debit: number;
  credit: number;
  running: number;
  patientName: string | null;
  method: PaymentMethod | null;
  chequeNo: string | null;
  bank: string | null;
  boundCaseNo: number | null;
}

interface Raw {
  [key: string]: string | null;
}

/**
 * Per-doctor balance as a CTE; the SQL twin of `doctorBalance` (counted rule = `countedWhere`).
 * With `ids` only those doctors are aggregated (the doctors list shows one page of them).
 */
function balancesCte(ids?: readonly number[]) {
  const list = ids ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql``;
  const csF = ids ? sql`AND doctor_id IN (${list})` : sql``;
  const pF = ids ? sql`AND p.doctor_id IN (${list})` : sql``;
  const oF = ids ? sql`AND o.doctor_id IN (${list})` : sql``;
  const dF = ids ? sql`WHERE d.id IN (${list})` : sql``;
  return sql`
  cs AS (
    SELECT doctor_id, SUM(total) AS total FROM cases WHERE status <> 'cancelled' ${csF} GROUP BY doctor_id
  ),
  pm AS (
    SELECT p.doctor_id, SUM(p.amount) AS counted
    FROM payments p LEFT JOIN cheques ch ON ch.payment_id = p.id
    WHERE p.status = 'active' AND (p.method <> 'cheque' OR ch.status = 'cleared') ${pF}
    GROUP BY p.doctor_id
  ),
  pc AS (
    SELECT p.doctor_id, SUM(p.amount) AS pending
    FROM payments p JOIN cheques ch ON ch.payment_id = p.id
    WHERE p.status = 'active' AND ch.status = 'pending' ${pF}
    GROUP BY p.doctor_id
  ),
  po AS (
    SELECT o.doctor_id, SUM(o.amount) AS paid_out
    FROM outgoing_payments o LEFT JOIN cheques och ON och.outgoing_payment_id = o.id
    WHERE o.kind = 'doctor_refund' AND ${OUT_COUNTED_SQL} ${oF}
    GROUP BY o.doctor_id
  ),
  bal AS (
    SELECT d.id, d.name, d.active,
           d.opening_balance + COALESCE(cs.total, 0) - COALESCE(pm.counted, 0) + COALESCE(po.paid_out, 0) AS balance,
           COALESCE(pc.pending, 0) AS pending
    FROM doctors d
    LEFT JOIN cs ON cs.doctor_id = d.id
    LEFT JOIN pm ON pm.doctor_id = d.id
    LEFT JOIN pc ON pc.doctor_id = d.id
    LEFT JOIN po ON po.doctor_id = d.id
    ${dF}
  )`;
}

@Injectable()
export class LedgerRepository {
  /**
   * Everything `allocate` and `doctorBalance` need for a set of doctors, in five statements however
   * many doctors there are. Counted payments are summed in SQL per (doctor, bound case), so a doctor
   * with 10 000 payments sends one row per bound case plus one unbound row, never the payments.
   * Refunds (B4b) are rare and dated FIFO items, so they come one row each, with the pending refund
   * cheques summed in the same statement.
   */
  async doctorInputs(db: Executor, doctorIds: readonly number[]): Promise<Map<number, DoctorLedgerInput>> {
    const out = new Map<number, DoctorLedgerInput>();
    if (doctorIds.length === 0) return out;
    const ids = [...new Set(doctorIds)];
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    const [doctorRows, caseRows, countedRows, pendingRows, refundRows] = await readAll(db, [
      db
        .select({ id: doctors.id, name: doctors.name, opening: doctors.openingBalance })
        .from(doctors)
        .where(inArray(doctors.id, ids)),
      db
        .select({
          doctorId: cases.doctorId,
          id: cases.id,
          caseNo: cases.caseNo,
          receivedDate: cases.receivedDate,
          total: cases.total,
          status: cases.status,
        })
        .from(cases)
        .where(inArray(cases.doctorId, ids))
        .orderBy(asc(cases.receivedDate), asc(cases.caseNo)),
      db
        .select({
          doctorId: payments.doctorId,
          caseId: payments.caseId,
          amount: sql<string>`sum(${payments.amount})`,
        })
        .from(payments)
        .leftJoin(cheques, eq(cheques.paymentId, payments.id))
        .where(and(inArray(payments.doctorId, ids), countedWhere()))
        .groupBy(payments.doctorId, payments.caseId),
      db
        .select({ doctorId: payments.doctorId, sum: sql<string>`sum(${payments.amount})` })
        .from(payments)
        .innerJoin(cheques, eq(cheques.paymentId, payments.id))
        .where(and(inArray(payments.doctorId, ids), eq(payments.status, 'active'), eq(cheques.status, 'pending')))
        .groupBy(payments.doctorId),
      db.execute<Raw>(sql`
        SELECT o.doctor_id::text AS doctor_id, o.id::text AS id, o.voucher_no::text AS voucher_no,
               ${OUT_EFFECTIVE_SQL}::text AS date, o.amount::text AS amount,
               (${OUT_COUNTED_SQL})::text AS counted
        FROM outgoing_payments o LEFT JOIN cheques och ON och.outgoing_payment_id = o.id
        WHERE o.kind = 'doctor_refund' AND o.doctor_id IN (${idList}) AND o.status = 'active'
          AND (${OUT_COUNTED_SQL} OR och.status = 'pending')
        ORDER BY 4, o.voucher_no`),
    ]);
    for (const d of doctorRows) {
      out.set(d.id, {
        doctorId: d.id,
        doctorName: d.name,
        opening: d.opening,
        cases: [],
        counted: [],
        refunds: [],
        pendingCheques: 0,
        pendingRefundCheques: 0,
      });
    }
    for (const r of refundRows.rows) {
      const input = out.get(Number(r.doctor_id));
      if (!input) continue;
      if (r.counted === 'true') {
        input.refunds.push({
          id: Number(r.id),
          voucherNo: Number(r.voucher_no),
          date: r.date ?? '',
          amount: Number(r.amount),
        });
      } else input.pendingRefundCheques += Number(r.amount);
    }
    for (const c of caseRows) {
      out.get(c.doctorId)?.cases.push({
        id: c.id,
        caseNo: c.caseNo,
        receivedDate: c.receivedDate,
        total: c.total,
        cancelled: c.status === 'cancelled',
      });
    }
    for (const p of countedRows) out.get(p.doctorId)?.counted.push({ amount: Number(p.amount), caseId: p.caseId });
    for (const p of pendingRows) {
      const input = out.get(p.doctorId);
      if (input) input.pendingCheques = Number(p.sum);
    }
    return out;
  }

  async doctorInput(db: Executor, doctorId: number): Promise<DoctorLedgerInput | undefined> {
    return (await this.doctorInputs(db, [doctorId])).get(doctorId);
  }

  /** Balance and pending cheques of one page of doctors (the doctors list), one statement. */
  async balancesOf(
    db: Executor,
    doctorIds: readonly number[],
  ): Promise<Map<number, { balance: number; pendingCheques: number }>> {
    const out = new Map<number, { balance: number; pendingCheques: number }>();
    if (doctorIds.length === 0) return out;
    const result = await db.execute<Raw>(sql`
      WITH ${balancesCte(doctorIds)}
      SELECT id::text AS id, balance::text AS balance, pending::text AS pending FROM bal`);
    for (const r of result.rows) out.set(Number(r.id), { balance: Number(r.balance), pendingCheques: Number(r.pending) });
    return out;
  }

  /** Patient name and status of a page of cases (the breakdown names the cases it lists). */
  async casesByIds(
    db: Executor,
    ids: readonly number[],
  ): Promise<Map<number, { patientName: string; status: string }>> {
    const out = new Map<number, { patientName: string; status: string }>();
    if (ids.length === 0) return out;
    const rows = await db
      .select({ id: cases.id, patientName: cases.patientName, status: cases.status })
      .from(cases)
      .where(inArray(cases.id, [...ids]));
    for (const r of rows) out.set(r.id, { patientName: r.patientName, status: r.status });
    return out;
  }

  /** The latest payments of a doctor, newest first, voided ones hidden (the breakdown footer). */
  async latestPayments(db: Executor, doctorId: number, limit: number) {
    const rows = await db
      .select({
        id: payments.id,
        voucherNo: payments.voucherNo,
        paidAt: payments.paidAt,
        method: payments.method,
        amount: payments.amount,
        counted: sql<boolean>`(${countedWhere()})`,
        caseNo: cases.caseNo,
      })
      .from(payments)
      .leftJoin(cheques, eq(cheques.paymentId, payments.id))
      .leftJoin(cases, eq(cases.id, payments.caseId))
      .where(and(eq(payments.doctorId, doctorId), eq(payments.status, 'active')))
      .orderBy(desc(payments.paidAt), desc(payments.id))
      .limit(limit);
    return rows;
  }

  /** Σ of payments bound to a case that count now — used by the cancel audit entry. */
  async boundActiveTotal(db: Executor, caseId: number): Promise<number> {
    const [row] = await db
      .select({ sum: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .leftJoin(cheques, eq(cheques.paymentId, payments.id))
      .where(
        and(
          eq(payments.caseId, caseId),
          eq(payments.status, 'active'),
          or(ne(payments.method, 'cheque'), ne(cheques.status, 'returned')),
        ),
      );
    return Number(row?.sum ?? 0);
  }

  async debtSummary(db: Executor): Promise<DebtSummary> {
    const result = await db.execute<Raw>(sql`
      WITH ${balancesCte()}
      SELECT count(*) FILTER (WHERE balance <> 0)::text AS parties,
             COALESCE(sum(balance) FILTER (WHERE balance > 0), 0)::text AS owed_to_lab,
             COALESCE(-sum(balance) FILTER (WHERE balance < 0), 0)::text AS owed_by_lab
      FROM bal`);
    const r = result.rows[0] ?? {};
    return {
      parties: Number(r.parties ?? 0),
      owedToLab: Number(r.owed_to_lab ?? 0),
      owedByLab: Number(r.owed_by_lab ?? 0),
    };
  }

  async debts(
    db: Executor,
    q: { direction: 'owed_to_lab' | 'owed_by_lab' | 'all'; search?: string; offset: number; limit: number },
  ): Promise<{ rows: DebtRow[]; total: number }> {
    const directionSql =
      q.direction === 'owed_to_lab'
        ? sql`balance > 0`
        : q.direction === 'owed_by_lab'
          ? sql`balance < 0`
          : sql`balance <> 0`;
    const searchSql = q.search ? sql`AND name ILIKE ${q.search}` : sql``;
    const result = await db.execute<Raw>(sql`
      WITH ${balancesCte()}
      SELECT id::text AS id, name, active::text AS active, balance::text AS balance,
             pending::text AS pending, count(*) OVER ()::text AS total
      FROM bal
      WHERE ${directionSql} ${searchSql}
      ORDER BY abs(balance) DESC, name ASC, id ASC
      LIMIT ${q.limit} OFFSET ${q.offset}`);
    return {
      rows: result.rows.map((r) => ({
        doctorId: Number(r.id),
        name: r.name ?? '',
        active: r.active === 'true',
        balance: Number(r.balance),
        pendingCheques: Number(r.pending),
      })),
      total: Number(result.rows[0]?.total ?? 0),
    };
  }

  /**
   * Home figures (SPEC §5.1, S7). A cheque counts on the day it was cleared. The incoming figures read
   * only `payments`; the outgoing ones (B4b) only `outgoing_payments`, through their own cheque join.
   */
  async summary(db: Executor, monthFrom: string, today: string, soonUntil: string) {
    const [owed, received, cheq, out] = await Promise.all([
      db.execute<Raw>(sql`
        WITH ${balancesCte()}
        SELECT COALESCE(sum(balance) FILTER (WHERE balance > 0), 0)::text AS owed FROM bal`),
      db.execute<Raw>(sql`
        SELECT COALESCE(sum(p.amount), 0)::text AS total,
               COALESCE(sum(p.amount) FILTER (
                 WHERE (CASE WHEN p.method = 'cheque' THEN ch.status_date ELSE p.paid_at END)
                       BETWEEN ${monthFrom}::date AND ${today}::date), 0)::text AS month
        FROM payments p LEFT JOIN cheques ch ON ch.payment_id = p.id
        WHERE p.status = 'active' AND (p.method <> 'cheque' OR ch.status = 'cleared')`),
      db.execute<Raw>(sql`
        SELECT count(*)::text AS pending_count,
               COALESCE(sum(p.amount), 0)::text AS pending_amount,
               count(*) FILTER (WHERE ch.due_date >= ${today}::date AND ch.due_date <= ${soonUntil}::date)::text AS due_soon,
               count(*) FILTER (WHERE ch.due_date < ${today}::date)::text AS overdue
        FROM cheques ch JOIN payments p ON p.id = ch.payment_id
        WHERE p.status = 'active' AND ch.status = 'pending'`),
      db.execute<Raw>(sql`
        SELECT COALESCE(sum(o.amount) FILTER (WHERE ${OUT_COUNTED_SQL}), 0)::text AS total,
               COALESCE(sum(o.amount) FILTER (WHERE ${OUT_COUNTED_SQL}
                 AND ${OUT_EFFECTIVE_SQL} BETWEEN ${monthFrom}::date AND ${today}::date), 0)::text AS month,
               count(*) FILTER (WHERE o.status = 'active' AND och.status = 'pending'
                 AND och.due_date >= ${today}::date AND och.due_date <= ${soonUntil}::date)::text AS due_soon,
               count(*) FILTER (WHERE o.status = 'active' AND och.status = 'pending'
                 AND och.due_date < ${today}::date)::text AS overdue
        FROM outgoing_payments o LEFT JOIN cheques och ON och.outgoing_payment_id = o.id`),
    ]);
    return {
      outgoingTotal: Number(out.rows[0]?.total ?? 0),
      outgoingThisMonth: Number(out.rows[0]?.month ?? 0),
      outgoingChequesDueSoon: Number(out.rows[0]?.due_soon ?? 0),
      outgoingChequesOverdue: Number(out.rows[0]?.overdue ?? 0),
      owedToLab: Number(owed.rows[0]?.owed ?? 0),
      receivedTotal: Number(received.rows[0]?.total ?? 0),
      receivedThisMonth: Number(received.rows[0]?.month ?? 0),
      pendingChequesCount: Number(cheq.rows[0]?.pending_count ?? 0),
      pendingChequesAmount: Number(cheq.rows[0]?.pending_amount ?? 0),
      chequesDueSoon: Number(cheq.rows[0]?.due_soon ?? 0),
      chequesOverdue: Number(cheq.rows[0]?.overdue ?? 0),
    };
  }

  /**
   * Cash summary (SPEC §10, B4b X7): money that actually moved in a period, in and out, on its effective
   * date (cash/transfer: payment date; cheque: the day it cleared), split by method so the cash-only figure
   * can be read. Each side reads only its own table.
   */
  async cashFlow(db: Executor, from: string, to: string) {
    const [inRows, outRows] = await Promise.all([
      db.execute<Raw>(sql`
        SELECT COALESCE(sum(p.amount), 0)::text AS total,
               COALESCE(sum(p.amount) FILTER (WHERE p.method = 'cash'), 0)::text AS cash,
               COALESCE(sum(p.amount) FILTER (WHERE p.method = 'transfer'), 0)::text AS transfer,
               COALESCE(sum(p.amount) FILTER (WHERE p.method = 'cheque'), 0)::text AS cheque
        FROM payments p LEFT JOIN cheques ch ON ch.payment_id = p.id
        WHERE p.status = 'active' AND (p.method <> 'cheque' OR ch.status = 'cleared')
          AND (CASE WHEN p.method = 'cheque' THEN ch.status_date ELSE p.paid_at END)
              BETWEEN ${from}::date AND ${to}::date`),
      db.execute<Raw>(sql`
        SELECT COALESCE(sum(o.amount), 0)::text AS total,
               COALESCE(sum(o.amount) FILTER (WHERE o.method = 'cash'), 0)::text AS cash,
               COALESCE(sum(o.amount) FILTER (WHERE o.method = 'transfer'), 0)::text AS transfer,
               COALESCE(sum(o.amount) FILTER (WHERE o.method = 'cheque'), 0)::text AS cheque,
               COALESCE(sum(o.amount) FILTER (WHERE o.kind = 'expense'), 0)::text AS expenses,
               COALESCE(sum(o.amount) FILTER (WHERE o.kind = 'doctor_refund'), 0)::text AS refunds
        FROM outgoing_payments o LEFT JOIN cheques och ON och.outgoing_payment_id = o.id
        WHERE ${OUT_COUNTED_SQL} AND ${OUT_EFFECTIVE_SQL} BETWEEN ${from}::date AND ${to}::date`),
    ]);
    const i = inRows.rows[0] ?? {};
    const o = outRows.rows[0] ?? {};
    const n = (r: Raw, k: string) => Number(r[k] ?? 0);
    const income = { total: n(i, 'total'), cash: n(i, 'cash'), transfer: n(i, 'transfer'), cheque: n(i, 'cheque') };
    const out = {
      total: n(o, 'total'),
      cash: n(o, 'cash'),
      transfer: n(o, 'transfer'),
      cheque: n(o, 'cheque'),
      expenses: n(o, 'expenses'),
      refunds: n(o, 'refunds'),
    };
    return { from, to, in: income, out, net: income.total - out.total };
  }

  /**
   * Statement events of one doctor, with a running balance computed over ALL his events so every
   * page agrees. A cheque credits on the day it cleared and debits again on the day it returned
   * after clearing; pending and void cheques are not events. `opening` is added to every line.
   */
  async statement(
    db: Executor,
    doctorId: number,
    opening: number,
    range: { from?: string; to?: string },
    offset: number,
    limit: number,
  ): Promise<{
    lines: StatementLine[];
    total: number;
    periodOpening: number;
    periodNet: number;
    totalDebit: number;
    totalCredit: number;
  }> {
    const from = range.from ?? null;
    const to = range.to ?? null;
    const events = sql`
      ev AS (
        SELECT c.received_date AS date, 1 AS ord, 'case' AS kind, c.id AS ref_id,
               c.case_no::text AS ref, c.total AS debit, 0::bigint AS credit,
               c.patient_name AS patient, NULL::text AS method, NULL::text AS cheque_no,
               NULL::text AS bank, NULL::bigint AS bound_case_no
        FROM cases c WHERE c.doctor_id = ${doctorId} AND c.status <> 'cancelled'
        UNION ALL
        SELECT p.paid_at, 2, 'payment', p.id, p.voucher_no::text, 0::bigint, p.amount,
               NULL, p.method, NULL, NULL, bc.case_no
        FROM payments p LEFT JOIN cases bc ON bc.id = p.case_id
        WHERE p.doctor_id = ${doctorId} AND p.status = 'active' AND p.method <> 'cheque'
        UNION ALL
        SELECT h.status_date, 2, 'payment', p.id, p.voucher_no::text, 0::bigint, p.amount,
               NULL, p.method, ch.cheque_no, ch.bank, bc.case_no
        FROM cheque_status_history h
        JOIN cheques ch ON ch.id = h.cheque_id
        JOIN payments p ON p.id = ch.payment_id
        LEFT JOIN cases bc ON bc.id = p.case_id
        WHERE p.doctor_id = ${doctorId} AND p.status = 'active' AND h.to_status = 'cleared'
        UNION ALL
        SELECT h.status_date, 3, 'cheque_return', p.id, p.voucher_no::text, p.amount, 0::bigint,
               NULL, p.method, ch.cheque_no, ch.bank, bc.case_no
        FROM cheque_status_history h
        JOIN cheques ch ON ch.id = h.cheque_id
        JOIN payments p ON p.id = ch.payment_id
        LEFT JOIN cases bc ON bc.id = p.case_id
        WHERE p.doctor_id = ${doctorId} AND p.status = 'active'
          AND h.to_status = 'returned' AND h.from_status = 'cleared'
        UNION ALL
        -- B4b: a refund to the doctor is a debit on its effective date (cash/transfer: payment date).
        SELECT o.paid_at, 4, 'refund', o.id, o.voucher_no::text, o.amount, 0::bigint,
               NULL, o.method, NULL, NULL, NULL
        FROM outgoing_payments o
        WHERE o.doctor_id = ${doctorId} AND o.kind = 'doctor_refund' AND o.status = 'active'
          AND o.method <> 'cheque'
        UNION ALL
        -- ... a refund cheque on the day it cleared ...
        SELECT h.status_date, 4, 'refund', o.id, o.voucher_no::text, o.amount, 0::bigint,
               NULL, o.method, ch.cheque_no, ch.bank, NULL
        FROM cheque_status_history h
        JOIN cheques ch ON ch.id = h.cheque_id
        JOIN outgoing_payments o ON o.id = ch.outgoing_payment_id
        WHERE o.doctor_id = ${doctorId} AND o.kind = 'doctor_refund' AND o.status = 'active'
          AND h.to_status = 'cleared'
        UNION ALL
        -- ... and a credit again on the day a cleared refund cheque came back.
        SELECT h.status_date, 5, 'refund_cheque_return', o.id, o.voucher_no::text, 0::bigint, o.amount,
               NULL, o.method, ch.cheque_no, ch.bank, NULL
        FROM cheque_status_history h
        JOIN cheques ch ON ch.id = h.cheque_id
        JOIN outgoing_payments o ON o.id = ch.outgoing_payment_id
        WHERE o.doctor_id = ${doctorId} AND o.kind = 'doctor_refund' AND o.status = 'active'
          AND h.to_status = 'returned' AND h.from_status = 'cleared'
      ),
      run AS (
        SELECT ev.*, ${opening}::bigint + SUM(debit - credit)
               OVER (ORDER BY date, ord, ref_id ROWS UNBOUNDED PRECEDING) AS running
        FROM ev
      )`;
    const inRange = sql`(${from}::date IS NULL OR date >= ${from}::date) AND (${to}::date IS NULL OR date <= ${to}::date)`;
    const [page, agg] = await readAll(db, [
      db.execute<Raw>(sql`
        WITH ${events}
        SELECT date::text AS date, kind, ref_id::text AS ref_id, ref, debit::text AS debit,
               credit::text AS credit, running::text AS running, count(*) OVER ()::text AS total,
               patient, method, cheque_no, bank, bound_case_no::text AS bound_case_no
        FROM run WHERE ${inRange}
        -- Qualified: a bare ref_id would be the text alias above and sort 10 before 9; the running balance is numeric.
        ORDER BY run.date, run.ord, run.ref_id
        LIMIT ${limit} OFFSET ${offset}`),
      db.execute<Raw>(sql`
        WITH ${events}
        SELECT COALESCE(sum(debit - credit) FILTER (WHERE ${from}::date IS NOT NULL AND date < ${from}::date), 0)::text AS before,
               COALESCE(sum(debit - credit) FILTER (WHERE ${inRange}), 0)::text AS net,
               count(*) FILTER (WHERE ${inRange})::text AS total,
               COALESCE(sum(debit) FILTER (WHERE ${inRange}), 0)::text AS debit,
               COALESCE(sum(credit) FILTER (WHERE ${inRange}), 0)::text AS credit
        FROM ev`),
    ]);
    return {
      lines: page.rows.map((r) => ({
        date: r.date ?? '',
        kind: r.kind as StatementLine['kind'],
        refId: Number(r.ref_id),
        ref: r.ref ?? '',
        debit: Number(r.debit),
        credit: Number(r.credit),
        running: Number(r.running),
        patientName: r.patient ?? null,
        method: (r.method as PaymentMethod | null) ?? null,
        chequeNo: r.cheque_no ?? null,
        bank: r.bank ?? null,
        boundCaseNo: r.bound_case_no === null || r.bound_case_no === undefined ? null : Number(r.bound_case_no),
      })),
      total: Number(agg.rows[0]?.total ?? 0),
      periodOpening: opening + Number(agg.rows[0]?.before ?? 0),
      periodNet: Number(agg.rows[0]?.net ?? 0),
      totalDebit: Number(agg.rows[0]?.debit ?? 0),
      totalCredit: Number(agg.rows[0]?.credit ?? 0),
    };
  }
}
