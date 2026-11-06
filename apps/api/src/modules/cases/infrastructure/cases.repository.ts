import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  notInArray,
  or,
  SQL,
  sql,
} from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import {
  caseItems,
  cases,
  caseStatusHistory,
  counters,
  doctorPrices,
  doctors,
  technicians,
  workTypes,
} from '../../../shared/db/schema';
import { offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';
import type { Area, CaseStatus, PriceSource } from '../domain/case-rules';

type Executor = Database | Tx;

export interface CaseRow {
  id: number;
  caseNo: number;
  doctorId: number;
  doctorName: string;
  patientName: string;
  technicianId: number | null;
  technicianName: string | null;
  receivedDate: string;
  expectedDate: string;
  deliveredDate: string | null;
  status: CaseStatus;
  discount: number;
  total: number;
  notes: string | null;
  rowVersion: number;
}

export interface CaseItemRow {
  id: number;
  toothNo: number | null;
  area: Area | null;
  workTypeId: number;
  workTypeName: string;
  shade: string | null;
  unitPrice: number;
  priceSource: PriceSource;
  note: string | null;
}

export type NewCaseItem = Omit<CaseItemRow, 'id'>;

export interface HistoryRow {
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  at: Date;
  note: string | null;
  deliveredDate: string | null;
  userId: number | null;
}

export interface CaseListQuery {
  status?: CaseStatus;
  doctorId?: number;
  overdue?: boolean;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export type CaseChanges = Partial<
  Pick<
    CaseRow,
    | 'patientName'
    | 'technicianId'
    | 'receivedDate'
    | 'expectedDate'
    | 'deliveredDate'
    | 'status'
    | 'discount'
    | 'total'
    | 'notes'
  >
>;

const caseCols = {
  id: cases.id,
  caseNo: cases.caseNo,
  doctorId: cases.doctorId,
  doctorName: doctors.name,
  patientName: cases.patientName,
  technicianId: cases.technicianId,
  technicianName: technicians.name,
  receivedDate: cases.receivedDate,
  expectedDate: cases.expectedDate,
  deliveredDate: cases.deliveredDate,
  status: cases.status,
  discount: cases.discount,
  total: cases.total,
  notes: cases.notes,
  rowVersion: cases.rowVersion,
};

const itemCols = {
  id: caseItems.id,
  toothNo: caseItems.toothNo,
  area: caseItems.area,
  workTypeId: caseItems.workTypeId,
  workTypeName: caseItems.workTypeName,
  shade: caseItems.shade,
  unitPrice: caseItems.unitPrice,
  priceSource: caseItems.priceSource,
  note: caseItems.note,
};

const asCase = (r: Record<string, unknown>) => r as unknown as CaseRow;
const asItem = (r: Record<string, unknown>) => r as unknown as CaseItemRow;

/** Overdue = expected date before the lab's today, still in the lab (same rule as isOverdue). */
export const overdueSql = (today: string): SQL =>
  and(lt(cases.expectedDate, today), notInArray(cases.status, ['delivered', 'cancelled'])) as SQL;

@Injectable()
export class CasesRepository {
  /** Gap-free: the counter row stays locked until the case insert commits or rolls back (SPEC §7.7). */
  async takeCaseNo(tx: Tx): Promise<number> {
    const [row] = await tx
      .update(counters)
      .set({ nextValue: sql`${counters.nextValue} + 1` })
      .where(eq(counters.name, 'case_no'))
      .returning({ issued: sql<number>`${counters.nextValue} - 1`.mapWith(Number) });
    if (!row) throw new Error('case_no counter missing (migration not applied?)');
    return row.issued;
  }

  async doctor(tx: Tx, id: number) {
    const [row] = await tx
      .select({ id: doctors.id, name: doctors.name, active: doctors.active })
      .from(doctors)
      .where(eq(doctors.id, id));
    return row;
  }

  async technician(tx: Tx, id: number) {
    const [row] = await tx
      .select({ id: technicians.id, name: technicians.name, active: technicians.active })
      .from(technicians)
      .where(eq(technicians.id, id));
    return row;
  }

  /** Work types with this doctor's special price, for price resolution at line creation. */
  async pricingFor(tx: Tx, doctorId: number, workTypeIds: number[]) {
    if (workTypeIds.length === 0) return [];
    return tx
      .select({
        id: workTypes.id,
        name: workTypes.name,
        active: workTypes.active,
        generalPrice: workTypes.unitPrice,
        specialPrice: doctorPrices.price,
      })
      .from(workTypes)
      .leftJoin(
        doctorPrices,
        and(eq(doctorPrices.workTypeId, workTypes.id), eq(doctorPrices.doctorId, doctorId)),
      )
      .where(inArray(workTypes.id, workTypeIds));
  }

  async insertCase(
    tx: Tx,
    values: Omit<CaseRow, 'id' | 'doctorName' | 'technicianName' | 'rowVersion' | 'deliveredDate'>,
    userId: number,
  ): Promise<number> {
    const [row] = await tx
      .insert(cases)
      .values({ ...values, createdBy: userId, updatedBy: userId })
      .returning({ id: cases.id });
    if (!row) throw new Error('case insert returned no row');
    return row.id;
  }

  async insertItems(tx: Tx, caseId: number, items: NewCaseItem[]): Promise<void> {
    if (items.length === 0) return;
    await tx.insert(caseItems).values(items.map((i) => ({ ...i, caseId })));
  }

  async insertHistory(tx: Tx, caseId: number, entry: Omit<HistoryRow, 'at'>): Promise<void> {
    await tx.insert(caseStatusHistory).values({ caseId, ...entry });
  }

  async findForUpdate(tx: Tx, id: number): Promise<CaseRow | undefined> {
    // Lock only the case row (doctor/technician rows are just read).
    const [row] = await tx
      .select(caseCols)
      .from(cases)
      .innerJoin(doctors, eq(doctors.id, cases.doctorId))
      .leftJoin(technicians, eq(technicians.id, cases.technicianId))
      .where(eq(cases.id, id))
      .for('update', { of: cases });
    return row ? asCase(row) : undefined;
  }

  async find(db: Executor, id: number): Promise<CaseRow | undefined> {
    const [row] = await db
      .select(caseCols)
      .from(cases)
      .innerJoin(doctors, eq(doctors.id, cases.doctorId))
      .leftJoin(technicians, eq(technicians.id, cases.technicianId))
      .where(eq(cases.id, id));
    return row ? asCase(row) : undefined;
  }

  async items(db: Executor, caseId: number): Promise<CaseItemRow[]> {
    const rows = await db
      .select(itemCols)
      .from(caseItems)
      .where(eq(caseItems.caseId, caseId))
      .orderBy(asc(caseItems.id));
    return rows.map(asItem);
  }

  async history(db: Executor, caseId: number): Promise<HistoryRow[]> {
    const rows = await db
      .select({
        fromStatus: caseStatusHistory.fromStatus,
        toStatus: caseStatusHistory.toStatus,
        at: caseStatusHistory.at,
        note: caseStatusHistory.note,
        deliveredDate: caseStatusHistory.deliveredDate,
        userId: caseStatusHistory.userId,
      })
      .from(caseStatusHistory)
      .where(eq(caseStatusHistory.caseId, caseId))
      .orderBy(asc(caseStatusHistory.at), asc(caseStatusHistory.id));
    return rows as HistoryRow[];
  }

  async updateCase(tx: Tx, id: number, changes: CaseChanges, userId: number): Promise<void> {
    await tx
      .update(cases)
      .set({ ...changes, rowVersion: sql`${cases.rowVersion} + 1`, updatedAt: new Date(), updatedBy: userId })
      .where(eq(cases.id, id));
  }

  async updateItem(
    tx: Tx,
    itemId: number,
    changes: Partial<Pick<CaseItemRow, 'unitPrice' | 'priceSource' | 'shade' | 'note'>>,
  ): Promise<void> {
    await tx.update(caseItems).set(changes).where(eq(caseItems.id, itemId));
  }

  async deleteItem(tx: Tx, itemId: number): Promise<void> {
    await tx.delete(caseItems).where(eq(caseItems.id, itemId));
  }

  async list(db: Executor, q: CaseListQuery, today: string): Promise<{ items: CaseRow[]; total: number }> {
    const search = q.search?.trim();
    const searchFilter = search
      ? /^\d{1,15}$/.test(search)
        ? or(eq(cases.caseNo, Number(search)), ilike(cases.patientName, containsPattern(search)))
        : ilike(cases.patientName, containsPattern(search))
      : undefined;
    const where = and(
      q.status ? eq(cases.status, q.status) : undefined,
      q.doctorId ? eq(cases.doctorId, q.doctorId) : undefined,
      q.overdue === true ? overdueSql(today) : undefined,
      q.overdue === false ? sql`not (${overdueSql(today)})` : undefined,
      q.from ? gte(cases.receivedDate, q.from) : undefined,
      q.to ? lte(cases.receivedDate, q.to) : undefined,
      searchFilter,
    );
    const rows = await db
      .select(caseCols)
      .from(cases)
      .innerJoin(doctors, eq(doctors.id, cases.doctorId))
      .leftJoin(technicians, eq(technicians.id, cases.technicianId))
      .where(where)
      .orderBy(desc(cases.receivedDate), desc(cases.caseNo))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [row] = await db.select({ n: count() }).from(cases).where(where);
    return { items: rows.map(asCase), total: row?.n ?? 0 };
  }
}
