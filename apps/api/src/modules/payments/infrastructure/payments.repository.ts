import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, SQL, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import {
  cases,
  chequeStatusHistory,
  cheques,
  counters,
  doctors,
  outgoingPayments,
  payments,
} from '../../../shared/db/schema';
import { offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';
import type { ChequeStatus, PaymentMethod, PaymentStatus } from '../domain/payment-rules';

type Executor = Database | Tx;

/** SQL twin of `isCounted` (SPEC §7.4); tests compare the two over the whole matrix. */
export const countedWhere = (): SQL =>
  and(eq(payments.status, 'active'), or(ne(payments.method, 'cheque'), eq(cheques.status, 'cleared'))) as SQL;

export interface ChequeRow {
  id: number;
  chequeNo: string;
  bank: string;
  dueDate: string;
  status: ChequeStatus;
  statusDate: string | null;
  rowVersion: number;
}

export interface PaymentRow {
  id: number;
  voucherNo: number;
  doctorId: number;
  doctorName: string;
  caseId: number | null;
  caseNo: number | null;
  method: PaymentMethod;
  amount: number;
  currencyCode: string;
  paidAt: string;
  notes: string | null;
  status: PaymentStatus;
  voidReason: string | null;
  voidedAt: Date | null;
  rowVersion: number;
  createdAt: Date;
  cheque: ChequeRow | null;
}

export interface NewPayment {
  voucherNo: number;
  doctorId: number;
  caseId: number | null;
  method: PaymentMethod;
  amount: number;
  currencyCode: string;
  paidAt: string;
  notes: string | null;
  idempotencyKey: string | null;
  requestHash: string | null;
}

export interface NewCheque {
  chequeNo: string;
  bank: string;
  dueDate: string;
}

export interface PaymentFilter {
  doctorId?: number;
  caseId?: number;
  method?: PaymentMethod;
  status?: PaymentStatus;
  counted?: boolean;
  from?: string;
  to?: string;
  search?: string;
}

const paymentCols = {
  id: payments.id,
  voucherNo: payments.voucherNo,
  doctorId: payments.doctorId,
  doctorName: doctors.name,
  caseId: payments.caseId,
  caseNo: cases.caseNo,
  method: payments.method,
  amount: payments.amount,
  currencyCode: payments.currencyCode,
  paidAt: payments.paidAt,
  notes: payments.notes,
  status: payments.status,
  voidReason: payments.voidReason,
  voidedAt: payments.voidedAt,
  rowVersion: payments.rowVersion,
  createdAt: payments.createdAt,
  chequeId: cheques.id,
  chequeNo: cheques.chequeNo,
  chequeBank: cheques.bank,
  chequeDueDate: cheques.dueDate,
  chequeStatus: cheques.status,
  chequeStatusDate: cheques.statusDate,
  chequeRowVersion: cheques.rowVersion,
};

function toRow(r: Record<string, unknown>): PaymentRow {
  const x = r as unknown as Omit<PaymentRow, 'cheque'> & {
    chequeId: number | null;
    chequeNo: string;
    chequeBank: string;
    chequeDueDate: string;
    chequeStatus: ChequeStatus;
    chequeStatusDate: string | null;
    chequeRowVersion: number;
  };
  const { chequeId, chequeNo, chequeBank, chequeDueDate, chequeStatus, chequeStatusDate, chequeRowVersion } =
    x;
  return {
    id: x.id,
    voucherNo: x.voucherNo,
    doctorId: x.doctorId,
    doctorName: x.doctorName,
    caseId: x.caseId,
    caseNo: x.caseNo,
    method: x.method,
    amount: x.amount,
    currencyCode: x.currencyCode,
    paidAt: x.paidAt,
    notes: x.notes,
    status: x.status,
    voidReason: x.voidReason,
    voidedAt: x.voidedAt,
    rowVersion: x.rowVersion,
    createdAt: x.createdAt,
    cheque:
      chequeId === null || chequeId === undefined
        ? null
        : {
            id: chequeId,
            chequeNo,
            bank: chequeBank,
            dueDate: chequeDueDate,
            status: chequeStatus,
            statusDate: chequeStatusDate,
            rowVersion: chequeRowVersion,
          },
  };
}

/** WHERE for the payments list; joined with doctors, cheques. */
function paymentWhere(f: PaymentFilter): SQL | undefined {
  const search = f.search?.trim();
  let searchSql: SQL | undefined;
  if (search) {
    const voucher = /^(?:in-?)?(\d{1,15})$/i.exec(search);
    const pattern = containsPattern(search);
    searchSql = or(
      voucher ? eq(payments.voucherNo, Number(voucher[1])) : undefined,
      ilike(doctors.name, pattern),
      ilike(cheques.chequeNo, pattern),
    );
  }
  return and(
    f.doctorId ? eq(payments.doctorId, f.doctorId) : undefined,
    f.caseId ? eq(payments.caseId, f.caseId) : undefined,
    f.method ? eq(payments.method, f.method) : undefined,
    f.status ? eq(payments.status, f.status) : undefined,
    f.counted === true ? countedWhere() : undefined,
    f.counted === false ? sql`not (${countedWhere()})` : undefined,
    f.from ? gte(payments.paidAt, f.from) : undefined,
    f.to ? lte(payments.paidAt, f.to) : undefined,
    searchSql,
  );
}

@Injectable()
export class PaymentsRepository {
  /** Gap-free: the counter row stays locked until the insert commits or rolls back (SPEC §7.7). */
  async takeVoucherNo(tx: Tx): Promise<number> {
    const [row] = await tx
      .update(counters)
      .set({ nextValue: sql`${counters.nextValue} + 1` })
      .where(eq(counters.name, 'payment_in_no'))
      .returning({ issued: sql<number>`${counters.nextValue} - 1`.mapWith(Number) });
    if (!row) throw new Error('payment_in_no counter missing (migration not applied?)');
    return row.issued;
  }

  /**
   * Serialises money writes of one doctor (ADR-0010). NO KEY UPDATE: it does not block the
   * foreign-key checks of inserts that only reference the doctor (cases, payments).
   */
  async lockDoctor(tx: Tx, id: number) {
    const [row] = await tx
      .select({ id: doctors.id, name: doctors.name, active: doctors.active })
      .from(doctors)
      .where(eq(doctors.id, id))
      .for('no key update');
    return row;
  }

  /** Share lock: a case edit (FOR UPDATE) cannot change the total under a bound-limit check. */
  async lockCase(tx: Tx, id: number) {
    const [row] = await tx
      .select({
        id: cases.id,
        caseNo: cases.caseNo,
        doctorId: cases.doctorId,
        total: cases.total,
        status: cases.status,
      })
      .from(cases)
      .where(eq(cases.id, id))
      .for('share');
    return row;
  }

  /** Active payments already bound to a case, except bounced cheques (the D5 limit). */
  async boundTotal(tx: Executor, caseId: number): Promise<number> {
    const [row] = await tx
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

  /** B5: active payments bound to a case whose cheque has not cleared yet (subtracted from what is due at delivery). */
  async pendingBoundCheques(db: Executor, caseId: number): Promise<number> {
    const [row] = await db
      .select({ sum: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .innerJoin(cheques, eq(cheques.paymentId, payments.id))
      .where(and(eq(payments.caseId, caseId), eq(payments.status, 'active'), eq(cheques.status, 'pending')));
    return Number(row?.sum ?? 0);
  }

  /**
   * Serialises the duplicate-cheque check for one bank + number across doctors. Per direction (B4b X11):
   * a doctor's cheque and the lab's own cheque with the same bank and number are different cheques.
   */
  async chequeDuplicate(tx: Tx, bank: string, chequeNo: string, direction: 'in' | 'out' = 'in'): Promise<boolean> {
    const lockKey = `${direction === 'out' ? 'cheque-out' : 'cheque'}|${bank.toLowerCase()}|${chequeNo}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const same = and(
      sql`lower(${cheques.bank}) = ${bank.toLowerCase()}`,
      eq(cheques.chequeNo, chequeNo),
      ne(cheques.status, 'returned'),
    );
    const rows =
      direction === 'out'
        ? await tx
            .select({ id: cheques.id })
            .from(cheques)
            .innerJoin(outgoingPayments, eq(outgoingPayments.id, cheques.outgoingPaymentId))
            .where(and(same, eq(outgoingPayments.status, 'active')))
            .limit(1)
        : await tx
            .select({ id: cheques.id })
            .from(cheques)
            .innerJoin(payments, eq(payments.id, cheques.paymentId))
            .where(and(same, eq(payments.status, 'active')))
            .limit(1);
    return rows.length > 0;
  }

  /** An Idempotency-Key names one request across BOTH payment tables (B4b): is it taken by the other one? */
  async keyUsedByOutgoing(db: Executor, key: string): Promise<boolean> {
    const rows = await db
      .select({ id: outgoingPayments.id })
      .from(outgoingPayments)
      .where(eq(outgoingPayments.idempotencyKey, key))
      .limit(1);
    return rows.length > 0;
  }

  async keyUsedByIncoming(db: Executor, key: string): Promise<boolean> {
    return (await this.byIdempotencyKey(db, key)) !== undefined;
  }

  async insertPayment(tx: Tx, v: NewPayment, userId: number): Promise<number> {
    const [row] = await tx
      .insert(payments)
      .values({ ...v, createdBy: userId, updatedBy: userId })
      .returning({ id: payments.id });
    if (!row) throw new Error('payment insert returned no row');
    return row.id;
  }

  /** A cheque belongs to exactly one payment, incoming or outgoing (the database checks it too). */
  async insertCheque(
    tx: Tx,
    owner: { paymentId: number } | { outgoingPaymentId: number },
    c: NewCheque,
    paidAt: string,
    userId: number,
  ): Promise<number> {
    const [row] = await tx
      .insert(cheques)
      .values({ ...owner, ...c, updatedBy: userId })
      .returning({ id: cheques.id });
    if (!row) throw new Error('cheque insert returned no row');
    await tx.insert(chequeStatusHistory).values({
      chequeId: row.id,
      fromStatus: null,
      toStatus: 'pending',
      statusDate: paidAt,
      userId,
    });
    return row.id;
  }

  async byIdempotencyKey(db: Executor, key: string) {
    const [row] = await db
      .select({ id: payments.id, requestHash: payments.requestHash, caseId: payments.caseId })
      .from(payments)
      .where(eq(payments.idempotencyKey, key));
    return row;
  }

  async find(db: Executor, id: number): Promise<PaymentRow | undefined> {
    const [row] = await db
      .select(paymentCols)
      .from(payments)
      .innerJoin(doctors, eq(doctors.id, payments.doctorId))
      .leftJoin(cases, eq(cases.id, payments.caseId))
      .leftJoin(cheques, eq(cheques.paymentId, payments.id))
      .where(eq(payments.id, id));
    return row ? toRow(row) : undefined;
  }

  async findMany(db: Executor, ids: number[]): Promise<PaymentRow[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select(paymentCols)
      .from(payments)
      .innerJoin(doctors, eq(doctors.id, payments.doctorId))
      .leftJoin(cases, eq(cases.id, payments.caseId))
      .leftJoin(cheques, eq(cheques.paymentId, payments.id))
      .where(inArray(payments.id, ids))
      .orderBy(desc(payments.paidAt), desc(payments.id));
    return rows.map(toRow);
  }

  async caseHeader(db: Executor, id: number) {
    const [row] = await db
      .select({ doctorId: cases.doctorId, total: cases.total })
      .from(cases)
      .where(eq(cases.id, id));
    return row;
  }

  async doctorIdOf(db: Executor, paymentId: number): Promise<number | undefined> {
    const [row] = await db
      .select({ doctorId: payments.doctorId })
      .from(payments)
      .where(eq(payments.id, paymentId));
    return row?.doctorId;
  }

  async doctorIdOfCheque(db: Executor, chequeId: number): Promise<number | undefined> {
    const [row] = await db
      .select({ doctorId: payments.doctorId })
      .from(cheques)
      .innerJoin(payments, eq(payments.id, cheques.paymentId))
      .where(eq(cheques.id, chequeId));
    return row?.doctorId;
  }

  async paymentForUpdate(tx: Tx, id: number) {
    const [row] = await tx
      .select({
        id: payments.id,
        voucherNo: payments.voucherNo,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        rowVersion: payments.rowVersion,
        doctorId: payments.doctorId,
      })
      .from(payments)
      .where(eq(payments.id, id))
      .for('update');
    return row;
  }

  async chequeStatusOf(db: Executor, paymentId: number): Promise<ChequeStatus | null> {
    const [row] = await db
      .select({ status: cheques.status })
      .from(cheques)
      .where(eq(cheques.paymentId, paymentId));
    return (row?.status as ChequeStatus | undefined) ?? null;
  }

  async markVoid(tx: Tx, id: number, reason: string, userId: number): Promise<void> {
    await tx
      .update(payments)
      .set({
        status: 'void',
        voidReason: reason,
        voidedAt: new Date(),
        voidedBy: userId,
        rowVersion: sql`${payments.rowVersion} + 1`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(payments.id, id));
  }

  async chequeForUpdate(tx: Tx, id: number) {
    const [row] = await tx
      .select({
        id: cheques.id,
        chequeNo: cheques.chequeNo,
        status: cheques.status,
        statusDate: cheques.statusDate,
        rowVersion: cheques.rowVersion,
        paymentId: cheques.paymentId,
        paymentStatus: payments.status,
        paidAt: payments.paidAt,
        voucherNo: payments.voucherNo,
        amount: payments.amount,
      })
      .from(cheques)
      .innerJoin(payments, eq(payments.id, cheques.paymentId))
      .where(eq(cheques.id, id))
      .for('update', { of: cheques });
    return row;
  }

  async changeChequeStatus(
    tx: Tx,
    id: number,
    from: ChequeStatus,
    to: ChequeStatus,
    statusDate: string,
    note: string | null,
    userId: number,
  ): Promise<void> {
    await tx
      .update(cheques)
      .set({
        status: to,
        statusDate,
        rowVersion: sql`${cheques.rowVersion} + 1`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(cheques.id, id));
    await tx
      .insert(chequeStatusHistory)
      .values({ chequeId: id, fromStatus: from, toStatus: to, statusDate, note, userId });
  }

  async chequeHistory(db: Executor, chequeId: number) {
    return db
      .select({
        fromStatus: chequeStatusHistory.fromStatus,
        toStatus: chequeStatusHistory.toStatus,
        statusDate: chequeStatusHistory.statusDate,
        at: chequeStatusHistory.at,
        note: chequeStatusHistory.note,
      })
      .from(chequeStatusHistory)
      .where(eq(chequeStatusHistory.chequeId, chequeId))
      .orderBy(asc(chequeStatusHistory.at), asc(chequeStatusHistory.id));
  }

  async list(
    db: Executor,
    f: PaymentFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: PaymentRow[]; total: number; countedTotal: number; pendingChequesTotal: number }> {
    const where = paymentWhere(f);
    const base = () =>
      db
        .select({
          total: sql<string>`count(*)`,
          counted: sql<string>`coalesce(sum(${payments.amount}) filter (where ${countedWhere()}), 0)`,
          pending: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'active' and ${cheques.status} = 'pending'), 0)`,
        })
        .from(payments)
        .innerJoin(doctors, eq(doctors.id, payments.doctorId))
        .leftJoin(cheques, eq(cheques.paymentId, payments.id))
        .where(where);
    const [rows, [agg]] = await Promise.all([
      db
        .select(paymentCols)
        .from(payments)
        .innerJoin(doctors, eq(doctors.id, payments.doctorId))
        .leftJoin(cases, eq(cases.id, payments.caseId))
        .leftJoin(cheques, eq(cheques.paymentId, payments.id))
        .where(where)
        .orderBy(desc(payments.paidAt), desc(payments.id))
        .limit(pageSize)
        .offset(offsetOf({ page, pageSize })),
      base(),
    ]);
    return {
      items: rows.map(toRow),
      total: Number(agg?.total ?? 0),
      countedTotal: Number(agg?.counted ?? 0),
      pendingChequesTotal: Number(agg?.pending ?? 0),
    };
  }

  /**
   * Receipts report figures (SPEC §5.8, B4 O3). Counted money is placed on its EFFECTIVE date — a cash or
   * transfer payment on its payment date, a cheque on the day it cleared — so a month here equals Home's
   * «received this month». Pending cheques and voided payments are memo lines by payment date.
   */
  async receiptsSummary(db: Executor, f: Omit<PaymentFilter, 'status' | 'counted'>) {
    const base = paymentWhere({ ...f, from: undefined, to: undefined });
    const eff = sql`(case when ${payments.method} = 'cheque' then ${cheques.statusDate} else ${payments.paidAt} end)`;
    const inEff = and(f.from ? sql`${eff} >= ${f.from}::date` : undefined, f.to ? sql`${eff} <= ${f.to}::date` : undefined);
    const inPaid = and(
      f.from ? gte(payments.paidAt, f.from) : undefined,
      f.to ? lte(payments.paidAt, f.to) : undefined,
    );
    const counted = and(countedWhere(), inEff);
    const sumIf = (cond: SQL | undefined) =>
      sql<string>`coalesce(sum(${payments.amount}) filter (where ${cond ?? sql`true`}), 0)`;
    const cntIf = (cond: SQL | undefined) => sql<string>`count(*) filter (where ${cond ?? sql`true`})`;
    const [agg] = await db
      .select({
        countedAmount: sumIf(counted),
        countedCount: cntIf(counted),
        cash: sumIf(and(counted, eq(payments.method, 'cash'))),
        transfer: sumIf(and(counted, eq(payments.method, 'transfer'))),
        cheque: sumIf(and(counted, eq(payments.method, 'cheque'))),
        pendingAmount: sumIf(and(eq(payments.status, 'active'), eq(cheques.status, 'pending'), inPaid)),
        pendingCount: cntIf(and(eq(payments.status, 'active'), eq(cheques.status, 'pending'), inPaid)),
        voidAmount: sumIf(and(eq(payments.status, 'void'), inPaid)),
        voidCount: cntIf(and(eq(payments.status, 'void'), inPaid)),
      })
      .from(payments)
      .innerJoin(doctors, eq(doctors.id, payments.doctorId))
      .leftJoin(cheques, eq(cheques.paymentId, payments.id))
      .where(base);
    const [last] = await db
      .select({ voucherNo: payments.voucherNo, paidAt: payments.paidAt, amount: payments.amount })
      .from(payments)
      .innerJoin(doctors, eq(doctors.id, payments.doctorId))
      .leftJoin(cheques, eq(cheques.paymentId, payments.id))
      .where(and(base, eq(payments.status, 'active'), inPaid))
      .orderBy(desc(payments.paidAt), desc(payments.id))
      .limit(1);
    return {
      counted: {
        amount: Number(agg?.countedAmount ?? 0),
        count: Number(agg?.countedCount ?? 0),
        byMethod: {
          cash: Number(agg?.cash ?? 0),
          transfer: Number(agg?.transfer ?? 0),
          cheque: Number(agg?.cheque ?? 0),
        },
      },
      pendingCheques: { count: Number(agg?.pendingCount ?? 0), amount: Number(agg?.pendingAmount ?? 0) },
      voided: { count: Number(agg?.voidCount ?? 0), amount: Number(agg?.voidAmount ?? 0) },
      last: last ?? null,
    };
  }

  // ---- cheque register ----

}
