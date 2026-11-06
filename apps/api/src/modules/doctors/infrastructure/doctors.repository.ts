import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { doctorPrices, doctors, workTypes } from '../../../shared/db/schema';
import { ListQuery, offsetOf } from '../../../shared/http/pagination';
import { containsPattern } from '../../../shared/text/names';

type Executor = Database | Tx;

export interface DoctorRecord {
  id: number;
  name: string;
  phone: string | null;
  clinic: string | null;
  notes: string | null;
  openingBalance: number;
  active: boolean;
  rowVersion: number;
}

export type DoctorChanges = Partial<Omit<DoctorRecord, 'id' | 'rowVersion'>>;

export interface DoctorPriceRow {
  workTypeId: number;
  workTypeName: string;
  workTypeActive: boolean;
  generalPrice: number;
  specialPrice: number | null;
}

const doctorCols = {
  id: doctors.id,
  name: doctors.name,
  phone: doctors.phone,
  clinic: doctors.clinic,
  notes: doctors.notes,
  openingBalance: doctors.openingBalance,
  active: doctors.active,
  rowVersion: doctors.rowVersion,
};

@Injectable()
export class DoctorsRepository {
  async list(db: Executor, q: ListQuery): Promise<{ items: DoctorRecord[]; total: number }> {
    const pattern = q.search ? containsPattern(q.search) : undefined;
    const where = and(
      pattern
        ? or(ilike(doctors.name, pattern), ilike(doctors.phone, pattern), ilike(doctors.clinic, pattern))
        : undefined,
      q.active === undefined ? undefined : eq(doctors.active, q.active),
    );
    const items = await db
      .select(doctorCols)
      .from(doctors)
      .where(where)
      .orderBy(asc(sql`lower(${doctors.name})`), asc(doctors.id))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    const [row] = await db.select({ n: count() }).from(doctors).where(where);
    return { items, total: row?.n ?? 0 };
  }

  async findById(db: Executor, id: number, forUpdate = false): Promise<DoctorRecord | undefined> {
    const query = db.select(doctorCols).from(doctors).where(eq(doctors.id, id));
    const [row] = forUpdate ? await query.for('update') : await query;
    return row;
  }

  async insert(
    tx: Tx,
    values: Pick<DoctorRecord, 'name' | 'phone' | 'clinic' | 'notes' | 'openingBalance'>,
    userId: number,
  ): Promise<DoctorRecord> {
    const [row] = await tx
      .insert(doctors)
      .values({ ...values, createdBy: userId, updatedBy: userId })
      .returning(doctorCols);
    if (!row) throw new Error('insert returned no row');
    return row;
  }

  async update(tx: Tx, id: number, changes: DoctorChanges, userId: number): Promise<DoctorRecord> {
    const [row] = await tx
      .update(doctors)
      .set({
        ...changes,
        rowVersion: sql`${doctors.rowVersion} + 1`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(doctors.id, id))
      .returning(doctorCols);
    if (!row) throw new Error('update returned no row');
    return row;
  }

  /** Special prices are configuration: they go with the doctor. Cases/payments (B2+) block via FK. */
  async delete(tx: Tx, id: number): Promise<void> {
    await tx.delete(doctorPrices).where(eq(doctorPrices.doctorId, id));
    await tx.delete(doctors).where(eq(doctors.id, id));
  }

  /** Active work types, plus inactive ones that still carry a special price for this doctor. */
  async listPrices(db: Executor, doctorId: number): Promise<DoctorPriceRow[]> {
    return db
      .select({
        workTypeId: workTypes.id,
        workTypeName: workTypes.name,
        workTypeActive: workTypes.active,
        generalPrice: workTypes.unitPrice,
        specialPrice: doctorPrices.price,
      })
      .from(workTypes)
      .leftJoin(
        doctorPrices,
        and(eq(doctorPrices.workTypeId, workTypes.id), eq(doctorPrices.doctorId, doctorId)),
      )
      .where(or(eq(workTypes.active, true), isNotNull(doctorPrices.price)))
      .orderBy(asc(workTypes.sortOrder), asc(sql`lower(${workTypes.name})`), asc(workTypes.id));
  }

  async findPriceForUpdate(tx: Tx, doctorId: number, workTypeId: number): Promise<number | undefined> {
    const [row] = await tx
      .select({ price: doctorPrices.price })
      .from(doctorPrices)
      .where(and(eq(doctorPrices.doctorId, doctorId), eq(doctorPrices.workTypeId, workTypeId)))
      .for('update');
    return row?.price;
  }

  async upsertPrice(
    tx: Tx,
    doctorId: number,
    workTypeId: number,
    price: number,
    userId: number,
  ): Promise<void> {
    await tx
      .insert(doctorPrices)
      .values({ doctorId, workTypeId, price, updatedBy: userId })
      .onConflictDoUpdate({
        target: [doctorPrices.doctorId, doctorPrices.workTypeId],
        set: { price, updatedAt: new Date(), updatedBy: userId },
      });
  }

  async deletePrice(tx: Tx, doctorId: number, workTypeId: number): Promise<void> {
    await tx
      .delete(doctorPrices)
      .where(and(eq(doctorPrices.doctorId, doctorId), eq(doctorPrices.workTypeId, workTypeId)));
  }

  async findWorkType(tx: Tx, id: number): Promise<{ id: number; name: string } | undefined> {
    const [row] = await tx
      .select({ id: workTypes.id, name: workTypes.name })
      .from(workTypes)
      .where(eq(workTypes.id, id));
    return row;
  }
}
