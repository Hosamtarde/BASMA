import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, SQL } from 'drizzle-orm';
import { containsPattern } from '../../../shared/text/names';
import type { Database, Tx } from '../../../shared/db/database';
import { caseItems, cases, counters, documentImages, doctors, invoiceCases, invoices } from '../../../shared/db/schema';
import type { InvoiceStatus, InvoiceType } from '@app/shared';

type Executor = Database | Tx;

export interface InvoiceRow {
  id: number;
  no: number;
  type: InvoiceType;
  doctorId: number | null;
  partyName: string;
  issueDate: string;
  language: 'ar' | 'en';
  currencyCode: string;
  subtotal: number | null;
  discount: number | null;
  total: number | null;
  status: InvoiceStatus;
  voidReason: string | null;
  voidedAt: Date | null;
  snapshotVersion: number;
  snapshotSha256: string;
  logoSha256: string | null;
  rowVersion: number;
  createdAt: Date;
}

export interface InvoiceWithSnapshot extends InvoiceRow {
  snapshot: unknown;
  requestHash: string | null;
}

export interface LockedCase {
  id: number;
  caseNo: number;
  doctorId: number;
  patientName: string;
  receivedDate: string;
  deliveredDate: string | null;
  status: string;
  discount: number;
  total: number;
}

export interface InvoiceItemRow {
  caseId: number;
  toothNo: number | null;
  area: string | null;
  workTypeName: string;
  shade: string | null;
  unitPrice: number;
}

export interface InvoiceFilter {
  type?: InvoiceType;
  status?: InvoiceStatus;
  doctorId?: number;
  from?: string;
  to?: string;
  search?: string;
}

const rowCols = {
  id: invoices.id,
  no: invoices.no,
  type: invoices.type,
  doctorId: invoices.doctorId,
  partyName: invoices.partyName,
  issueDate: invoices.issueDate,
  language: invoices.language,
  currencyCode: invoices.currencyCode,
  subtotal: invoices.subtotal,
  discount: invoices.discount,
  total: invoices.total,
  status: invoices.status,
  voidReason: invoices.voidReason,
  voidedAt: invoices.voidedAt,
  snapshotVersion: invoices.snapshotVersion,
  snapshotSha256: invoices.snapshotSha256,
  logoSha256: invoices.logoSha256,
  rowVersion: invoices.rowVersion,
  createdAt: invoices.createdAt,
};

const ELIGIBLE = sql.raw(`'delivered','ready'`);

/** Invoices (B6). Every query names its index in the schema; nothing here touches the ledger. */
@Injectable()
export class InvoicesRepository {
  async byIdempotencyKey(db: Executor, key: string): Promise<{ id: number; requestHash: string | null } | undefined> {
    const [row] = await db
      .select({ id: invoices.id, requestHash: invoices.requestHash })
      .from(invoices)
      .where(eq(invoices.idempotencyKey, key));
    return row;
  }

  async doctor(db: Executor, id: number) {
    const [row] = await db
      .select({ id: doctors.id, name: doctors.name, clinic: doctors.clinic, phone: doctors.phone })
      .from(doctors)
      .where(eq(doctors.id, id));
    return row;
  }

  /** Case rows locked in id order (ADR-0010: a case edit takes the same lock, so the two serialise). */
  async lockCases(tx: Tx, ids: readonly number[], lock = true): Promise<LockedCase[]> {
    if (ids.length === 0) return [];
    const query = tx
      .select({
        id: cases.id,
        caseNo: cases.caseNo,
        doctorId: cases.doctorId,
        patientName: cases.patientName,
        receivedDate: cases.receivedDate,
        deliveredDate: cases.deliveredDate,
        status: cases.status,
        discount: cases.discount,
        total: cases.total,
      })
      .from(cases)
      .where(inArray(cases.id, [...ids]))
      .orderBy(asc(cases.id));
    return lock ? query.for('update') : query;
  }

  /** The active invoice of each case that has one (one statement for any number of cases). */
  async activeInvoicesOf(db: Executor, caseIds: readonly number[]): Promise<Map<number, { id: number; no: number }>> {
    const out = new Map<number, { id: number; no: number }>();
    if (caseIds.length === 0) return out;
    const rows = await db
      .select({ caseId: invoiceCases.caseId, id: invoices.id, no: invoices.no })
      .from(invoiceCases)
      .innerJoin(invoices, eq(invoices.id, invoiceCases.invoiceId))
      .where(and(eq(invoiceCases.active, true), inArray(invoiceCases.caseId, [...caseIds])));
    for (const r of rows) out.set(r.caseId, { id: r.id, no: r.no });
    return out;
  }

  async items(db: Executor, caseIds: readonly number[]): Promise<InvoiceItemRow[]> {
    if (caseIds.length === 0) return [];
    return db
      .select({
        caseId: caseItems.caseId,
        toothNo: caseItems.toothNo,
        area: caseItems.area,
        workTypeName: caseItems.workTypeName,
        shade: caseItems.shade,
        unitPrice: caseItems.unitPrice,
      })
      .from(caseItems)
      .where(inArray(caseItems.caseId, [...caseIds]))
      .orderBy(asc(caseItems.caseId), asc(caseItems.id));
  }

  /** Gap-free: the number is taken inside the insert transaction; a rollback gives it back (SPEC §7.7). */
  async takeInvoiceNo(tx: Tx): Promise<number> {
    const [row] = await tx
      .update(counters)
      .set({ nextValue: sql`${counters.nextValue} + 1` })
      .where(eq(counters.name, 'invoice_no'))
      .returning({ issued: sql<number>`${counters.nextValue} - 1`.mapWith(Number) });
    if (!row) throw new Error('invoice_no counter missing (migration not applied?)');
    return row.issued;
  }

  /** Content-addressed: the same logo used by many invoices is stored once. */
  async freezeImage(tx: Tx, img: { sha256: string; mimeType: string; content: Buffer }): Promise<void> {
    await tx
      .insert(documentImages)
      .values({ sha256: img.sha256, mimeType: img.mimeType, sizeBytes: img.content.length, content: img.content })
      .onConflictDoNothing();
  }

  async image(db: Executor, sha256: string) {
    const [row] = await db
      .select({ mimeType: documentImages.mimeType, sizeBytes: documentImages.sizeBytes, content: documentImages.content })
      .from(documentImages)
      .where(eq(documentImages.sha256, sha256));
    return row;
  }

  async insert(
    tx: Tx,
    row: {
      no: number;
      type: InvoiceType;
      doctorId: number | null;
      partyName: string;
      issueDate: string;
      language: 'ar' | 'en';
      currencyCode: string;
      subtotal: number | null;
      discount: number | null;
      total: number | null;
      snapshot: unknown;
      snapshotVersion: number;
      snapshotSha256: string;
      logoSha256: string | null;
      idempotencyKey: string | null;
      requestHash: string | null;
    },
    userId: number,
  ): Promise<number> {
    const [inserted] = await tx
      .insert(invoices)
      .values({ ...row, createdBy: userId, updatedBy: userId })
      .returning({ id: invoices.id });
    if (!inserted) throw new Error('invoice insert returned nothing');
    return inserted.id;
  }

  async linkCases(tx: Tx, invoiceId: number, caseIds: readonly number[]): Promise<void> {
    if (caseIds.length === 0) return;
    await tx.insert(invoiceCases).values(caseIds.map((caseId) => ({ invoiceId, caseId })));
  }

  async find(db: Executor, id: number): Promise<InvoiceWithSnapshot | undefined> {
    const [row] = await db
      .select({ ...rowCols, snapshot: invoices.snapshot, requestHash: invoices.requestHash })
      .from(invoices)
      .where(eq(invoices.id, id));
    return row as InvoiceWithSnapshot | undefined;
  }

  async forUpdate(tx: Tx, id: number) {
    const [row] = await tx
      .select({ id: invoices.id, no: invoices.no, type: invoices.type, status: invoices.status, doctorId: invoices.doctorId, rowVersion: invoices.rowVersion })
      .from(invoices)
      .where(eq(invoices.id, id))
      .for('update');
    return row;
  }

  async doctorIdOf(db: Executor, id: number): Promise<number | null | undefined> {
    const [row] = await db.select({ doctorId: invoices.doctorId }).from(invoices).where(eq(invoices.id, id));
    return row ? row.doctorId : undefined;
  }

  async markVoid(tx: Tx, id: number, reason: string, userId: number): Promise<void> {
    const now = new Date();
    await tx
      .update(invoices)
      .set({
        status: 'void',
        voidReason: reason,
        voidedAt: now,
        voidedBy: userId,
        rowVersion: sql`${invoices.rowVersion} + 1`,
        updatedAt: now,
        updatedBy: userId,
      })
      .where(eq(invoices.id, id));
    await tx
      .update(invoiceCases)
      .set({ active: false })
      .where(and(eq(invoiceCases.invoiceId, id), eq(invoiceCases.active, true)));
  }

  /** Case ids of an invoice (active or not), for the audit entry. */
  async caseNosOf(db: Executor, invoiceId: number): Promise<number[]> {
    const rows = await db
      .select({ caseNo: cases.caseNo })
      .from(invoiceCases)
      .innerJoin(cases, eq(cases.id, invoiceCases.caseId))
      .where(eq(invoiceCases.invoiceId, invoiceId))
      .orderBy(asc(cases.caseNo));
    return rows.map((r) => r.caseNo);
  }

  private where(f: InvoiceFilter): SQL | undefined {
    const parts: (SQL | undefined)[] = [];
    if (f.type) parts.push(eq(invoices.type, f.type));
    if (f.status) parts.push(eq(invoices.status, f.status));
    if (f.doctorId) parts.push(eq(invoices.doctorId, f.doctorId));
    if (f.from) parts.push(sql`${invoices.issueDate} >= ${f.from}`);
    if (f.to) parts.push(sql`${invoices.issueDate} <= ${f.to}`);
    if (f.search) {
      const text = f.search.trim();
      const digits = /^\d{1,15}$/.test(text) ? Number(text) : null;
      parts.push(
        or(
          ilike(invoices.partyName, containsPattern(text)),
          ...(digits !== null ? [eq(invoices.no, digits)] : []),
        ),
      );
    }
    const defined = parts.filter((p): p is SQL => p !== undefined);
    return defined.length > 0 ? and(...defined) : undefined;
  }

  async list(db: Executor, f: InvoiceFilter, offset: number, limit: number): Promise<{ items: InvoiceRow[]; total: number }> {
    const where = this.where(f);
    const [items, [count]] = await Promise.all([
      db
        .select(rowCols)
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.issueDate), desc(invoices.id))
        .offset(offset)
        .limit(limit),
      db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(invoices).where(where),
    ]);
    return { items: items as InvoiceRow[], total: count?.n ?? 0 };
  }

  /** For the CSV: the same filter, capped by the caller. */
  async listAll(db: Executor, f: InvoiceFilter, limit: number): Promise<InvoiceRow[]> {
    const rows = await db
      .select(rowCols)
      .from(invoices)
      .where(this.where(f))
      .orderBy(desc(invoices.issueDate), desc(invoices.id))
      .limit(limit);
    return rows as InvoiceRow[];
  }

  /** Counts per status and type (Home «الفواتير», the list chips) — one grouped statement. */
  async summary(db: Executor): Promise<{ status: string; type: string; n: number }[]> {
    return db
      .select({ status: invoices.status, type: invoices.type, n: sql<number>`count(*)`.mapWith(Number) })
      .from(invoices)
      .groupBy(invoices.status, invoices.type);
  }

  /** «حالات منجزة غير مفوترة»: delivered or ready, not on an active invoice, oldest first (SPEC §5.14). */
  async eligible(db: Executor, doctorId: number, offset: number, limit: number) {
    const where = and(
      eq(cases.doctorId, doctorId),
      sql`${cases.status} in (${ELIGIBLE})`,
      sql`not exists (select 1 from ${invoiceCases} ic where ic.case_id = ${cases.id} and ic.active)`,
    );
    const [items, [count]] = await Promise.all([
      db
        .select({
          id: cases.id,
          caseNo: cases.caseNo,
          doctorId: cases.doctorId,
          patientName: cases.patientName,
          receivedDate: cases.receivedDate,
          deliveredDate: cases.deliveredDate,
          status: cases.status,
          total: cases.total,
        })
        .from(cases)
        .where(where)
        .orderBy(asc(cases.receivedDate), asc(cases.caseNo))
        .offset(offset)
        .limit(limit),
      db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(cases).where(where),
    ]);
    return { items, total: count?.n ?? 0 };
  }
}
