import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, sql, SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database, Tx } from '../../../shared/db/database';
import { doctorPrices, expenseCategories, technicians, workTypes } from '../../../shared/db/schema';
import { ListQuery, offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';

type Executor = Database | Tx;

export interface TechnicianRecord {
  id: number;
  name: string;
  active: boolean;
  rowVersion: number;
}

export interface WorkTypeRecord extends TechnicianRecord {
  unitPrice: number;
  sortOrder: number;
}

export interface ExpenseCategoryRecord extends TechnicianRecord {
  isDoctor: boolean;
}

function listFilter(name: AnyPgColumn, active: AnyPgColumn, q: ListQuery): SQL | undefined {
  return and(
    q.search ? ilike(name, containsPattern(q.search)) : undefined,
    q.active === undefined ? undefined : eq(active, q.active),
  );
}

const bump = (rowVersion: AnyPgColumn) => sql`${rowVersion} + 1`;

const technicianCols = {
  id: technicians.id,
  name: technicians.name,
  active: technicians.active,
  rowVersion: technicians.rowVersion,
};
const workTypeCols = {
  id: workTypes.id,
  name: workTypes.name,
  unitPrice: workTypes.unitPrice,
  sortOrder: workTypes.sortOrder,
  active: workTypes.active,
  rowVersion: workTypes.rowVersion,
};
const categoryCols = {
  id: expenseCategories.id,
  name: expenseCategories.name,
  isDoctor: expenseCategories.isDoctor,
  active: expenseCategories.active,
  rowVersion: expenseCategories.rowVersion,
};

@Injectable()
export class TechniciansRepository {
  async list(db: Executor, q: ListQuery): Promise<{ items: TechnicianRecord[]; total: number }> {
    const where = listFilter(technicians.name, technicians.active, q);
    const items = await db
      .select(technicianCols)
      .from(technicians)
      .where(where)
      .orderBy(asc(sql`lower(${technicians.name})`), asc(technicians.id))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [row] = await db.select({ n: count() }).from(technicians).where(where);
    return { items, total: row?.n ?? 0 };
  }

  async findForUpdate(tx: Tx, id: number): Promise<TechnicianRecord | undefined> {
    const [row] = await tx
      .select(technicianCols)
      .from(technicians)
      .where(eq(technicians.id, id))
      .for('update');
    return row;
  }

  async insert(tx: Tx, name: string, userId: number): Promise<TechnicianRecord> {
    const [row] = await tx
      .insert(technicians)
      .values({ name, createdBy: userId, updatedBy: userId })
      .returning(technicianCols);
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  async update(
    tx: Tx,
    id: number,
    changes: Partial<Pick<TechnicianRecord, 'name' | 'active'>>,
    userId: number,
  ): Promise<TechnicianRecord> {
    const [row] = await tx
      .update(technicians)
      .set({ ...changes, rowVersion: bump(technicians.rowVersion), updatedAt: new Date(), updatedBy: userId })
      .where(eq(technicians.id, id))
      .returning(technicianCols);
    if (!row) throw new Error('update returned no row');
    return row;
  }

  async delete(tx: Tx, id: number): Promise<void> {
    await tx.delete(technicians).where(eq(technicians.id, id));
  }
}

@Injectable()
export class WorkTypesRepository {
  async list(db: Executor, q: ListQuery): Promise<{ items: WorkTypeRecord[]; total: number }> {
    const where = listFilter(workTypes.name, workTypes.active, q);
    const items = await db
      .select(workTypeCols)
      .from(workTypes)
      .where(where)
      .orderBy(asc(workTypes.sortOrder), asc(sql`lower(${workTypes.name})`), asc(workTypes.id))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [row] = await db.select({ n: count() }).from(workTypes).where(where);
    return { items, total: row?.n ?? 0 };
  }

  async findForUpdate(tx: Tx, id: number): Promise<WorkTypeRecord | undefined> {
    const [row] = await tx.select(workTypeCols).from(workTypes).where(eq(workTypes.id, id)).for('update');
    return row;
  }

  async insert(
    tx: Tx,
    values: { name: string; unitPrice: number; sortOrder: number },
    userId: number,
  ): Promise<WorkTypeRecord> {
    const [row] = await tx
      .insert(workTypes)
      .values({ ...values, createdBy: userId, updatedBy: userId })
      .returning(workTypeCols);
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  async update(
    tx: Tx,
    id: number,
    changes: Partial<Pick<WorkTypeRecord, 'name' | 'unitPrice' | 'sortOrder' | 'active'>>,
    userId: number,
  ): Promise<WorkTypeRecord> {
    const [row] = await tx
      .update(workTypes)
      .set({ ...changes, rowVersion: bump(workTypes.rowVersion), updatedAt: new Date(), updatedBy: userId })
      .where(eq(workTypes.id, id))
      .returning(workTypeCols);
    if (!row) throw new Error('update returned no row');
    return row;
  }

  /** Special prices are configuration, not usage: they go with the work type. */
  async delete(tx: Tx, id: number): Promise<void> {
    await tx.delete(doctorPrices).where(eq(doctorPrices.workTypeId, id));
    await tx.delete(workTypes).where(eq(workTypes.id, id));
  }
}

@Injectable()
export class ExpenseCategoriesRepository {
  async list(db: Executor, q: ListQuery): Promise<{ items: ExpenseCategoryRecord[]; total: number }> {
    const where = listFilter(expenseCategories.name, expenseCategories.active, q);
    const items = await db
      .select(categoryCols)
      .from(expenseCategories)
      .where(where)
      .orderBy(asc(sql`lower(${expenseCategories.name})`), asc(expenseCategories.id))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [row] = await db.select({ n: count() }).from(expenseCategories).where(where);
    return { items, total: row?.n ?? 0 };
  }

  async findForUpdate(tx: Tx, id: number): Promise<ExpenseCategoryRecord | undefined> {
    const [row] = await tx
      .select(categoryCols)
      .from(expenseCategories)
      .where(eq(expenseCategories.id, id))
      .for('update');
    return row;
  }

  async insert(
    tx: Tx,
    values: { name: string; isDoctor: boolean },
    userId: number,
  ): Promise<ExpenseCategoryRecord> {
    const [row] = await tx
      .insert(expenseCategories)
      .values({ ...values, createdBy: userId, updatedBy: userId })
      .returning(categoryCols);
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  async update(
    tx: Tx,
    id: number,
    changes: Partial<Pick<ExpenseCategoryRecord, 'name' | 'active'>>,
    userId: number,
  ): Promise<ExpenseCategoryRecord> {
    const [row] = await tx
      .update(expenseCategories)
      .set({
        ...changes,
        rowVersion: bump(expenseCategories.rowVersion),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(expenseCategories.id, id))
      .returning(categoryCols);
    if (!row) throw new Error('update returned no row');
    return row;
  }

  async delete(tx: Tx, id: number): Promise<void> {
    await tx.delete(expenseCategories).where(eq(expenseCategories.id, id));
  }
}
