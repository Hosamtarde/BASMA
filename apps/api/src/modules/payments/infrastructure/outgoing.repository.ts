import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, lte, ne, or, SQL, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import {
  chequeStatusHistory,
  cheques,
  counters,
  doctors,
  expenseCategories,
  outgoingPayments,
} from '../../../shared/db/schema';
import { offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';
import {
  ChequeStatus,
  OutgoingKind,
  parseVoucher,
  PaymentMethod,
  PaymentStatus,
} from '../domain/payment-rules';
import type { ChequeRow } from './payments.repository';

type Executor = Database | Tx;

/**
 * SQL twin of `isCounted` for outgoing money (SPEC §7.4: an outgoing cheque counts only once cleared), on
 * `outgoing_payments LEFT JOIN cheques ON cheques.outgoing_payment_id = outgoing_payments.id`.
 */
export const outCountedWhere = (): SQL =>
  and(
    eq(outgoingPayments.status, 'active'),
    or(ne(outgoingPayments.method, 'cheque'), eq(cheques.status, 'cleared')),
  ) as SQL;

/** Payment date, or the day a cheque cleared (only meaningful while it counts). */
export const outEffectiveDate = (): SQL =>
  sql`(case when ${outgoingPayments.method} = 'cheque' then ${cheques.statusDate} else ${outgoingPayments.paidAt} end)`;

export interface OutgoingRow {
  id: number;
  voucherNo: number;
  kind: OutgoingKind;
  categoryId: number;
  categoryName: string;
  doctorId: number | null;
  doctorName: string | null;
  payee: string | null;
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

export interface NewOutgoing {
  voucherNo: number;
  kind: OutgoingKind;
  categoryId: number;
  doctorId: number | null;
  payee: string | null;
  method: PaymentMethod;
  amount: number;
  currencyCode: string;
  paidAt: string;
  notes: string | null;
  idempotencyKey: string | null;
  requestHash: string | null;
}

export interface OutgoingFilter {
  categoryId?: number;
  kind?: OutgoingKind;
  doctorId?: number;
  method?: PaymentMethod;
  status?: PaymentStatus;
  counted?: boolean;
  /** Payment (voucher) date. */
  from?: string;
  to?: string;
  search?: string;
}

const cols = {
  id: outgoingPayments.id,
  voucherNo: outgoingPayments.voucherNo,
  kind: outgoingPayments.kind,
  categoryId: outgoingPayments.categoryId,
  categoryName: expenseCategories.name,
  doctorId: outgoingPayments.doctorId,
  doctorName: doctors.name,
  payee: outgoingPayments.payee,
  method: outgoingPayments.method,
  amount: outgoingPayments.amount,
  currencyCode: outgoingPayments.currencyCode,
  paidAt: outgoingPayments.paidAt,
  notes: outgoingPayments.notes,
  status: outgoingPayments.status,
  voidReason: outgoingPayments.voidReason,
  voidedAt: outgoingPayments.voidedAt,
  rowVersion: outgoingPayments.rowVersion,
  createdAt: outgoingPayments.createdAt,
  chequeId: cheques.id,
  chequeNo: cheques.chequeNo,
  chequeBank: cheques.bank,
  chequeDueDate: cheques.dueDate,
  chequeStatus: cheques.status,
  chequeStatusDate: cheques.statusDate,
  chequeRowVersion: cheques.rowVersion,
};

type RawRow = { [K in keyof typeof cols]: unknown };

function toRow(r: RawRow): OutgoingRow {
  const x = r as unknown as Omit<OutgoingRow, 'cheque'> & {
    chequeId: number | null;
    chequeNo: string;
    chequeBank: string;
    chequeDueDate: string;
    chequeStatus: ChequeStatus;
    chequeStatusDate: string | null;
    chequeRowVersion: number;
  };
  return {
    id: x.id,
    voucherNo: x.voucherNo,
    kind: x.kind,
    categoryId: x.categoryId,
    categoryName: x.categoryName,
    doctorId: x.doctorId,
    doctorName: x.doctorName,
    payee: x.payee,
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
      x.chequeId === null || x.chequeId === undefined
        ? null
        : {
            id: x.chequeId,
            chequeNo: x.chequeNo,
            bank: x.chequeBank,
            dueDate: x.chequeDueDate,
            status: x.chequeStatus,
            statusDate: x.chequeStatusDate,
            rowVersion: x.chequeRowVersion,
          },
  };
}

/** WHERE of the outgoing list; joined with categories, doctors (left) and cheques (left). */
export function outgoingWhere(f: OutgoingFilter): SQL | undefined {
  const search = f.search?.trim();
  let searchSql: SQL | undefined;
  if (search) {
    const voucher = parseVoucher(search);
    const pattern = containsPattern(search);
    searchSql = or(
      voucher && voucher.direction !== 'in' ? eq(outgoingPayments.voucherNo, voucher.no) : undefined,
      ilike(outgoingPayments.payee, pattern),
      ilike(doctors.name, pattern),
      ilike(cheques.chequeNo, pattern),
    );
  }
  return and(
    f.categoryId ? eq(outgoingPayments.categoryId, f.categoryId) : undefined,
    f.kind ? eq(outgoingPayments.kind, f.kind) : undefined,
    f.doctorId ? eq(outgoingPayments.doctorId, f.doctorId) : undefined,
    f.method ? eq(outgoingPayments.method, f.method) : undefined,
    f.status ? eq(outgoingPayments.status, f.status) : undefined,
    f.counted === true ? outCountedWhere() : undefined,
    f.counted === false ? sql`not (${outCountedWhere()})` : undefined,
    f.from ? gte(outgoingPayments.paidAt, f.from) : undefined,
    f.to ? lte(outgoingPayments.paidAt, f.to) : undefined,
    searchSql,
  );
}

/** Outgoing payments (B4b, SPEC §5.9). Reads and writes only `outgoing_payments` and its own cheques. */
@Injectable()
export class OutgoingRepository {
  /** Gap-free OUT- number; the counter row stays locked until commit or rollback (SPEC §7.7). */
  async takeVoucherNo(tx: Tx): Promise<number> {
    const [row] = await tx
      .update(counters)
      .set({ nextValue: sql`${counters.nextValue} + 1` })
      .where(eq(counters.name, 'payment_out_no'))
      .returning({ issued: sql<number>`${counters.nextValue} - 1`.mapWith(Number) });
    if (!row) throw new Error('payment_out_no counter missing (migration not applied?)');
    return row.issued;
  }

  /** The category, without a lock: `is_doctor` never changes, so it tells the kind before the locks. */
  async category(db: Executor, id: number) {
    const [row] = await db
      .select({ id: expenseCategories.id, name: expenseCategories.name, isDoctor: expenseCategories.isDoctor })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, id));
    return row;
  }

  /** SHARE lock: a concurrent deactivate (FOR UPDATE) waits, so "active" holds until the insert commits. */
  async lockCategory(tx: Tx, id: number) {
    const [row] = await tx
      .select({ id: expenseCategories.id, name: expenseCategories.name, active: expenseCategories.active })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, id))
      .for('share');
    return row;
  }

  async insert(tx: Tx, v: NewOutgoing, userId: number): Promise<number> {
    const [row] = await tx
      .insert(outgoingPayments)
      .values({ ...v, createdBy: userId, updatedBy: userId })
      .returning({ id: outgoingPayments.id });
    if (!row) throw new Error('outgoing payment insert returned no row');
    return row.id;
  }

  async byIdempotencyKey(db: Executor, key: string) {
    const [row] = await db
      .select({ id: outgoingPayments.id, requestHash: outgoingPayments.requestHash })
      .from(outgoingPayments)
      .where(eq(outgoingPayments.idempotencyKey, key));
    return row;
  }

  private base(db: Executor) {
    return db
      .select(cols)
      .from(outgoingPayments)
      .innerJoin(expenseCategories, eq(expenseCategories.id, outgoingPayments.categoryId))
      .leftJoin(doctors, eq(doctors.id, outgoingPayments.doctorId))
      .leftJoin(cheques, eq(cheques.outgoingPaymentId, outgoingPayments.id));
  }

  async find(db: Executor, id: number): Promise<OutgoingRow | undefined> {
    const [row] = await this.base(db).where(eq(outgoingPayments.id, id));
    return row ? toRow(row) : undefined;
  }

  /** Doctor (refunds only) and kind of an outgoing payment, read before the locks. */
  async head(db: Executor, id: number) {
    const [row] = await db
      .select({ doctorId: outgoingPayments.doctorId, kind: outgoingPayments.kind })
      .from(outgoingPayments)
      .where(eq(outgoingPayments.id, id));
    return row;
  }

  async forUpdate(tx: Tx, id: number) {
    const [row] = await tx
      .select({
        id: outgoingPayments.id,
        voucherNo: outgoingPayments.voucherNo,
        amount: outgoingPayments.amount,
        method: outgoingPayments.method,
        kind: outgoingPayments.kind,
        status: outgoingPayments.status,
        rowVersion: outgoingPayments.rowVersion,
      })
      .from(outgoingPayments)
      .where(eq(outgoingPayments.id, id))
      .for('update');
    return row;
  }

  async chequeStatusOf(db: Executor, outgoingId: number): Promise<ChequeStatus | null> {
    const [row] = await db
      .select({ status: cheques.status })
      .from(cheques)
      .where(eq(cheques.outgoingPaymentId, outgoingId));
    return (row?.status as ChequeStatus | undefined) ?? null;
  }

  async markVoid(tx: Tx, id: number, reason: string, userId: number): Promise<void> {
    await tx
      .update(outgoingPayments)
      .set({
        status: 'void',
        voidReason: reason,
        voidedAt: new Date(),
        voidedBy: userId,
        rowVersion: sql`${outgoingPayments.rowVersion} + 1`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(outgoingPayments.id, id));
  }

  /** Doctor (refund cheques only) of an outgoing cheque; undefined when the cheque is not outgoing. */
  async headOfCheque(db: Executor, chequeId: number) {
    const [row] = await db
      .select({ doctorId: outgoingPayments.doctorId })
      .from(cheques)
      .innerJoin(outgoingPayments, eq(outgoingPayments.id, cheques.outgoingPaymentId))
      .where(eq(cheques.id, chequeId));
    return row;
  }

  async chequeForUpdate(tx: Tx, id: number) {
    const [row] = await tx
      .select({
        id: cheques.id,
        chequeNo: cheques.chequeNo,
        status: cheques.status,
        statusDate: cheques.statusDate,
        rowVersion: cheques.rowVersion,
        outgoingId: outgoingPayments.id,
        paymentStatus: outgoingPayments.status,
        paidAt: outgoingPayments.paidAt,
        voucherNo: outgoingPayments.voucherNo,
        amount: outgoingPayments.amount,
      })
      .from(cheques)
      .innerJoin(outgoingPayments, eq(outgoingPayments.id, cheques.outgoingPaymentId))
      .where(eq(cheques.id, id))
      .for('update', { of: cheques });
    return row;
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

  /**
   * The expenses report figures (SPEC §5.9, §10; B4b X4/X5). Counted money is placed on its EFFECTIVE
   * date (a cheque on the day it cleared), so a month here equals Home's «outgoing this month»; pending
   * cheques and voided payments are memo lines by payment date. Same filters as the list except status,
   * counted and paging. Totals per category include categories that are now inactive.
   */
  async summary(db: Executor, f: Omit<OutgoingFilter, 'status' | 'counted'>) {
    const base = outgoingWhere({ ...f, from: undefined, to: undefined });
    const eff = outEffectiveDate();
    const inEff = and(f.from ? sql`${eff} >= ${f.from}::date` : undefined, f.to ? sql`${eff} <= ${f.to}::date` : undefined);
    const inPaid = and(
      f.from ? gte(outgoingPayments.paidAt, f.from) : undefined,
      f.to ? lte(outgoingPayments.paidAt, f.to) : undefined,
    );
    const counted = and(outCountedWhere(), inEff);
    const pending = and(eq(outgoingPayments.status, 'active'), eq(cheques.status, 'pending'), inPaid);
    const voided = and(eq(outgoingPayments.status, 'void'), inPaid);
    const sumIf = (cond: SQL | undefined) =>
      sql<string>`coalesce(sum(${outgoingPayments.amount}) filter (where ${cond ?? sql`true`}), 0)`;
    const cntIf = (cond: SQL | undefined) => sql<string>`count(*) filter (where ${cond ?? sql`true`})`;
    const from = () =>
      db
        .select({
          categoryId: outgoingPayments.categoryId,
          name: expenseCategories.name,
          kind: outgoingPayments.kind,
          countedAmount: sumIf(counted),
          countedCount: cntIf(counted),
          cash: sumIf(and(counted, eq(outgoingPayments.method, 'cash'))),
          transfer: sumIf(and(counted, eq(outgoingPayments.method, 'transfer'))),
          cheque: sumIf(and(counted, eq(outgoingPayments.method, 'cheque'))),
          pendingAmount: sumIf(pending),
          pendingCount: cntIf(pending),
          voidAmount: sumIf(voided),
          voidCount: cntIf(voided),
        })
        .from(outgoingPayments)
        .innerJoin(expenseCategories, eq(expenseCategories.id, outgoingPayments.categoryId))
        .leftJoin(doctors, eq(doctors.id, outgoingPayments.doctorId))
        .leftJoin(cheques, eq(cheques.outgoingPaymentId, outgoingPayments.id))
        .where(base)
        .groupBy(outgoingPayments.categoryId, expenseCategories.name, outgoingPayments.kind)
        .orderBy(asc(sql`lower(${expenseCategories.name})`), asc(outgoingPayments.categoryId));
    const [groups, [last]] = await Promise.all([
      from(),
      db
        .select({ voucherNo: outgoingPayments.voucherNo, paidAt: outgoingPayments.paidAt, amount: outgoingPayments.amount })
        .from(outgoingPayments)
        .innerJoin(expenseCategories, eq(expenseCategories.id, outgoingPayments.categoryId))
        .leftJoin(doctors, eq(doctors.id, outgoingPayments.doctorId))
        .leftJoin(cheques, eq(cheques.outgoingPaymentId, outgoingPayments.id))
        .where(and(base, eq(outgoingPayments.status, 'active'), inPaid))
        .orderBy(desc(outgoingPayments.paidAt), desc(outgoingPayments.id))
        .limit(1),
    ]);
    const n = (v: string | number | null | undefined) => Number(v ?? 0);
    const byCategory = groups
      .map((g) => ({
        categoryId: g.categoryId,
        name: g.name,
        kind: g.kind as OutgoingKind,
        amount: n(g.countedAmount),
        count: n(g.countedCount),
        pendingCheques: { count: n(g.pendingCount), amount: n(g.pendingAmount) },
      }))
      .filter((g) => g.count > 0 || g.pendingCheques.count > 0);
    const total = (pick: (g: (typeof groups)[number]) => string | number) =>
      groups.reduce((s, g) => s + n(pick(g)), 0);
    return {
      counted: {
        amount: total((g) => g.countedAmount),
        count: total((g) => g.countedCount),
        byMethod: { cash: total((g) => g.cash), transfer: total((g) => g.transfer), cheque: total((g) => g.cheque) },
      },
      byCategory,
      refunds: groups.filter((g) => g.kind === 'doctor_refund').reduce((s, g) => s + n(g.countedAmount), 0),
      pendingCheques: { count: total((g) => g.pendingCount), amount: total((g) => g.pendingAmount) },
      voided: { count: total((g) => g.voidCount), amount: total((g) => g.voidAmount) },
      last: last ?? null,
    };
  }

  async list(
    db: Executor,
    f: OutgoingFilter,
    page: number,
    pageSize: number,
  ): Promise<{ items: OutgoingRow[]; total: number; countedTotal: number; pendingChequesTotal: number }> {
    const where = outgoingWhere(f);
    const [rows, [agg]] = await Promise.all([
      this.base(db)
        .where(where)
        .orderBy(desc(outgoingPayments.paidAt), desc(outgoingPayments.id))
        .limit(pageSize)
        .offset(offsetOf({ page, pageSize })),
      db
        .select({
          total: sql<string>`count(*)`,
          counted: sql<string>`coalesce(sum(${outgoingPayments.amount}) filter (where ${outCountedWhere()}), 0)`,
          pending: sql<string>`coalesce(sum(${outgoingPayments.amount}) filter (where ${outgoingPayments.status} = 'active' and ${cheques.status} = 'pending'), 0)`,
        })
        .from(outgoingPayments)
        .innerJoin(expenseCategories, eq(expenseCategories.id, outgoingPayments.categoryId))
        .leftJoin(doctors, eq(doctors.id, outgoingPayments.doctorId))
        .leftJoin(cheques, eq(cheques.outgoingPaymentId, outgoingPayments.id))
        .where(where),
    ]);
    return {
      items: rows.map(toRow),
      total: Number(agg?.total ?? 0),
      countedTotal: Number(agg?.counted ?? 0),
      pendingChequesTotal: Number(agg?.pending ?? 0),
    };
  }
}
