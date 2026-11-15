import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, or, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { cases, cheques, doctors, payments } from '../../../shared/db/schema';
import type { CountedPayment, LedgerCase } from '../domain/payment-rules';
import { countedWhere } from './payments.repository';

type Executor = Database | Tx;

export interface DoctorLedgerInput {
  doctorId: number;
  doctorName: string;
  opening: number;
  cases: LedgerCase[];
  counted: CountedPayment[];
  /** Σ active cheques still pending (shown separately, never reduce dues). */
  pendingCheques: number;
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

export interface StatementLine {
  date: string;
  kind: 'case' | 'payment' | 'cheque_return';
  refId: number;
  ref: string;
  debit: number;
  credit: number;
  running: number;
}

interface Raw {
  [key: string]: string | null;
}

/** Per-doctor balance as a CTE; the SQL twin of `doctorBalance` (counted rule = `countedWhere`). */
const balancesCte = sql`
  cs AS (
    SELECT doctor_id, SUM(total) AS total FROM cases WHERE status <> 'cancelled' GROUP BY doctor_id
  ),
  pm AS (
    SELECT p.doctor_id, SUM(p.amount) AS counted
    FROM payments p LEFT JOIN cheques ch ON ch.payment_id = p.id
    WHERE p.status = 'active' AND (p.method <> 'cheque' OR ch.status = 'cleared')
    GROUP BY p.doctor_id
  ),
  pc AS (
    SELECT p.doctor_id, SUM(p.amount) AS pending
    FROM payments p JOIN cheques ch ON ch.payment_id = p.id
    WHERE p.status = 'active' AND ch.status = 'pending'
    GROUP BY p.doctor_id
  ),
  bal AS (
    SELECT d.id, d.name, d.active,
           d.opening_balance + COALESCE(cs.total, 0) - COALESCE(pm.counted, 0) AS balance,
           COALESCE(pc.pending, 0) AS pending
    FROM doctors d
    LEFT JOIN cs ON cs.doctor_id = d.id
    LEFT JOIN pm ON pm.doctor_id = d.id
    LEFT JOIN pc ON pc.doctor_id = d.id
  )`;

@Injectable()
export class LedgerRepository {
  /** Everything `allocate` and `doctorBalance` need for one doctor, in three small queries. */
  async doctorInput(db: Executor, doctorId: number): Promise<DoctorLedgerInput | undefined> {
    const [doctor] = await db
      .select({ name: doctors.name, opening: doctors.openingBalance })
      .from(doctors)
      .where(eq(doctors.id, doctorId));
    if (!doctor) return undefined;
    const [caseRows, countedRows, [pending]] = await Promise.all([
      db
        .select({
          id: cases.id,
          caseNo: cases.caseNo,
          receivedDate: cases.receivedDate,
          total: cases.total,
          status: cases.status,
        })
        .from(cases)
        .where(eq(cases.doctorId, doctorId))
        .orderBy(asc(cases.receivedDate), asc(cases.caseNo)),
      db
        .select({ amount: payments.amount, caseId: payments.caseId })
        .from(payments)
        .leftJoin(cheques, eq(cheques.paymentId, payments.id))
        .where(and(eq(payments.doctorId, doctorId), countedWhere())),
      db
        .select({ sum: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .innerJoin(cheques, eq(cheques.paymentId, payments.id))
        .where(
          and(eq(payments.doctorId, doctorId), eq(payments.status, 'active'), eq(cheques.status, 'pending')),
        ),
    ]);
    return {
      doctorId,
      doctorName: doctor.name,
      opening: doctor.opening,
      cases: caseRows.map((c) => ({
        id: c.id,
        caseNo: c.caseNo,
        receivedDate: c.receivedDate,
        total: c.total,
        cancelled: c.status === 'cancelled',
      })),
      counted: countedRows,
      pendingCheques: Number(pending?.sum ?? 0),
    };
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
      WITH ${balancesCte}
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
      WITH ${balancesCte}
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

  /** Home figures (SPEC §5.1, S7). A cheque counts on the day it was cleared. */
  async summary(db: Executor, monthFrom: string, today: string, soonUntil: string) {
    const [owed, received, cheq] = await Promise.all([
      db.execute<Raw>(sql`
        WITH ${balancesCte}
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
    ]);
    return {
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
  ): Promise<{ lines: StatementLine[]; total: number; periodOpening: number; periodNet: number }> {
    const from = range.from ?? null;
    const to = range.to ?? null;
    const events = sql`
      ev AS (
        SELECT c.received_date AS date, 1 AS ord, 'case' AS kind, c.id AS ref_id,
               c.case_no::text AS ref, c.total AS debit, 0::bigint AS credit
        FROM cases c WHERE c.doctor_id = ${doctorId} AND c.status <> 'cancelled'
        UNION ALL
        SELECT p.paid_at, 2, 'payment', p.id, p.voucher_no::text, 0::bigint, p.amount
        FROM payments p
        WHERE p.doctor_id = ${doctorId} AND p.status = 'active' AND p.method <> 'cheque'
        UNION ALL
        SELECT h.status_date, 2, 'payment', p.id, p.voucher_no::text, 0::bigint, p.amount
        FROM cheque_status_history h
        JOIN cheques ch ON ch.id = h.cheque_id
        JOIN payments p ON p.id = ch.payment_id
        WHERE p.doctor_id = ${doctorId} AND p.status = 'active' AND h.to_status = 'cleared'
        UNION ALL
        SELECT h.status_date, 3, 'cheque_return', p.id, p.voucher_no::text, p.amount, 0::bigint
        FROM cheque_status_history h
        JOIN cheques ch ON ch.id = h.cheque_id
        JOIN payments p ON p.id = ch.payment_id
        WHERE p.doctor_id = ${doctorId} AND p.status = 'active'
          AND h.to_status = 'returned' AND h.from_status = 'cleared'
      ),
      run AS (
        SELECT ev.*, ${opening}::bigint + SUM(debit - credit)
               OVER (ORDER BY date, ord, ref_id ROWS UNBOUNDED PRECEDING) AS running
        FROM ev
      )`;
    const inRange = sql`(${from}::date IS NULL OR date >= ${from}::date) AND (${to}::date IS NULL OR date <= ${to}::date)`;
    const [page, agg] = await Promise.all([
      db.execute<Raw>(sql`
        WITH ${events}
        SELECT date::text AS date, kind, ref_id::text AS ref_id, ref, debit::text AS debit,
               credit::text AS credit, running::text AS running, count(*) OVER ()::text AS total
        FROM run WHERE ${inRange}
        ORDER BY date, ord, ref_id
        LIMIT ${limit} OFFSET ${offset}`),
      db.execute<Raw>(sql`
        WITH ${events}
        SELECT COALESCE(sum(debit - credit) FILTER (WHERE ${from}::date IS NOT NULL AND date < ${from}::date), 0)::text AS before,
               COALESCE(sum(debit - credit) FILTER (WHERE ${inRange}), 0)::text AS net,
               count(*) FILTER (WHERE ${inRange})::text AS total
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
      })),
      total: Number(agg.rows[0]?.total ?? 0),
      periodOpening: opening + Number(agg.rows[0]?.before ?? 0),
      periodNet: Number(agg.rows[0]?.net ?? 0),
    };
  }
}
