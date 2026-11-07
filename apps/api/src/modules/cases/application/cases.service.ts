import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditParams, AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent } from '../../../shared/db/aggregate';
import { lockCurrencyForMoneyWrite } from '../../../shared/db/currency-guard';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import {
  Area,
  canCancel,
  canEdit,
  CaseStatus,
  checkTransition,
  DEFAULT_INITIAL_STATUS,
  isOverdue,
  MAX_LINES_PER_CASE,
  resolvePrice,
  subtotalOf,
  totalOf,
} from '../domain/case-rules';
import {
  CaseChanges,
  CaseItemRow,
  CaseListQuery,
  CaseRow,
  CasesRepository,
  HistoryRow,
  NewCaseItem,
} from '../infrastructure/cases.repository';

export interface LineInput {
  toothNo?: number;
  area?: Area;
  workTypeId: number;
  shade?: string | null;
  /** Present = manual price override; absent = resolved by the server (SPEC §7.5). */
  unitPrice?: number;
  note?: string | null;
}

export interface NewCase {
  doctorId: number;
  patientName: string;
  technicianId?: number | null;
  receivedDate?: string;
  expectedDate: string;
  status?: CaseStatus;
  discount?: number;
  notes?: string | null;
  lines: LineInput[];
}

export type CaseHeaderPatch = Partial<
  Pick<CaseRow, 'patientName' | 'technicianId' | 'receivedDate' | 'expectedDate' | 'discount' | 'notes'>
>;

export interface CaseDetail extends CaseRow {
  subtotal: number;
  overdue: boolean;
  items: CaseItemRow[];
  history: HistoryRow[];
}

export interface CaseSummary extends CaseRow {
  overdue: boolean;
}

const err = (code: string, status: HttpStatus, params: Record<string, string | number> = {}) =>
  new DomainError(code, status, params);

/**
 * Cases (SPEC §5.3, §5.6, §9). Every write: currency SHARE lock (amounts) → case row lock →
 * one transaction with the total recomputed from the lines and an audit entry.
 * Patient names are never written to the audit log (owner decision B2).
 */
@Injectable()
export class CasesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: CasesRepository,
    private readonly calendar: LabCalendar,
    private readonly audit: AuditWriter,
  ) {}

  async list(
    q: CaseListQuery,
  ): Promise<{ items: CaseSummary[]; page: number; pageSize: number; total: number }> {
    const today = await this.calendar.today();
    const { items, total } = await this.repo.list(this.db, q, today);
    return {
      items: items.map((c) => ({ ...c, overdue: isOverdue(c, today) })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  async get(id: number): Promise<CaseDetail> {
    const found = await this.repo.find(this.db, id);
    if (!found) throw notFound();
    const [items, history, today] = await Promise.all([
      this.repo.items(this.db, id),
      this.repo.history(this.db, id),
      this.calendar.today(),
    ]);
    return { ...found, subtotal: subtotalOf(items), overdue: isOverdue(found, today), items, history };
  }

  async create(input: NewCase, userId: number): Promise<CaseDetail> {
    const id = await this.db.transaction(async (tx) => {
      await lockCurrencyForMoneyWrite(tx);
      const today = await this.calendar.today(tx);
      const receivedDate = input.receivedDate ?? today;
      this.checkHeaderDates(receivedDate, input.expectedDate, today);

      const doctor = await this.repo.doctor(tx, input.doctorId);
      if (!doctor) throw notFound();
      if (!doctor.active) throw err('error.case.doctor_inactive', HttpStatus.CONFLICT, { name: doctor.name });
      if (input.technicianId) await this.requireActiveTechnician(tx, input.technicianId);
      if (input.lines.length > MAX_LINES_PER_CASE) {
        throw err('error.case.too_many_lines', HttpStatus.CONFLICT, { max: MAX_LINES_PER_CASE });
      }

      const lines = await this.priceLines(tx, input.doctorId, input.lines);
      const discount = input.discount ?? 0;
      const total = this.totalOrThrow(subtotalOf(lines), discount);
      const status = input.status ?? DEFAULT_INITIAL_STATUS;

      const caseNo = await this.repo.takeCaseNo(tx);
      const caseId = await this.repo.insertCase(
        tx,
        {
          caseNo,
          doctorId: input.doctorId,
          patientName: input.patientName,
          technicianId: input.technicianId ?? null,
          receivedDate,
          expectedDate: input.expectedDate,
          status,
          discount,
          total,
          notes: input.notes ?? null,
        },
        userId,
      );
      await this.repo.insertItems(tx, caseId, lines);
      await this.repo.insertHistory(tx, caseId, {
        fromStatus: null,
        toStatus: status,
        note: null,
        deliveredDate: null,
        userId,
      });
      await this.audit.write(tx, {
        userId,
        action: 'case.created',
        entity: 'case',
        entityId: caseId,
        params: { caseNo, doctor: doctor.name, lines: lines.length, total },
      });
      return caseId;
    });
    return this.get(id);
  }

  /** Header edit. The doctor never changes after creation (owner decision B2). */
  async update(id: number, rowVersion: number, patch: CaseHeaderPatch, userId: number): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      if (patch.discount !== undefined) await lockCurrencyForMoneyWrite(tx);
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      const changes: CaseChanges = {};
      for (const key of Object.keys(patch) as (keyof CaseHeaderPatch)[]) {
        const value = patch[key];
        if (value !== undefined && value !== current[key]) Object.assign(changes, { [key]: value });
      }
      if (Object.keys(changes).length === 0) return;

      const today = await this.calendar.today(tx);
      const receivedDate = changes.receivedDate ?? current.receivedDate;
      const expectedDate = changes.expectedDate ?? current.expectedDate;
      if (changes.receivedDate !== undefined || changes.expectedDate !== undefined) {
        this.checkHeaderDates(receivedDate, expectedDate, today);
        if (current.deliveredDate !== null && current.deliveredDate < receivedDate) {
          throw err('error.case.delivered_date_invalid', HttpStatus.BAD_REQUEST);
        }
      }
      if (changes.technicianId) await this.requireActiveTechnician(tx, changes.technicianId);
      if (changes.discount !== undefined) {
        const items = await this.repo.items(tx, id);
        changes.total = this.totalOrThrow(subtotalOf(items), changes.discount);
      }

      await this.repo.updateCase(tx, id, changes, userId);
      const params: AuditParams = {
        caseNo: current.caseNo,
        fields: Object.keys(changes)
          .filter((k) => k !== 'total')
          .join(','),
      };
      if (changes.discount !== undefined) {
        params.discountOld = current.discount;
        params.discountNew = changes.discount;
      }
      await this.audit.write(tx, { userId, action: 'case.updated', entity: 'case', entityId: id, params });
    });
    return this.get(id);
  }

  async addLines(id: number, rowVersion: number, lines: LineInput[], userId: number): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      await lockCurrencyForMoneyWrite(tx);
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      const existing = await this.repo.items(tx, id);
      if (existing.length + lines.length > MAX_LINES_PER_CASE) {
        throw err('error.case.too_many_lines', HttpStatus.CONFLICT, { max: MAX_LINES_PER_CASE });
      }
      const priced = await this.priceLines(tx, current.doctorId, lines);
      await this.repo.insertItems(tx, id, priced);
      const total = this.totalOrThrow(subtotalOf([...existing, ...priced]), current.discount);
      await this.repo.updateCase(tx, id, { total }, userId);
      for (const line of priced) {
        await this.audit.write(tx, {
          userId,
          action: 'case.line_added',
          entity: 'case',
          entityId: id,
          params: { caseNo: current.caseNo, workType: line.workTypeName, unitPrice: line.unitPrice },
        });
      }
    });
    return this.get(id);
  }

  async updateLine(
    id: number,
    itemId: number,
    rowVersion: number,
    patch: { unitPrice?: number; shade?: string | null; note?: string | null },
    userId: number,
  ): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      if (patch.unitPrice !== undefined) await lockCurrencyForMoneyWrite(tx);
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      const items = await this.repo.items(tx, id);
      const item = items.find((i) => i.id === itemId);
      if (!item) throw notFound();

      const changes: Partial<Pick<CaseItemRow, 'unitPrice' | 'priceSource' | 'shade' | 'note'>> = {};
      if (patch.unitPrice !== undefined && patch.unitPrice !== item.unitPrice) {
        changes.unitPrice = patch.unitPrice;
        changes.priceSource = 'manual';
      }
      if (patch.shade !== undefined && patch.shade !== item.shade) changes.shade = patch.shade;
      if (patch.note !== undefined && patch.note !== item.note) changes.note = patch.note;
      if (Object.keys(changes).length === 0) return;

      await this.repo.updateItem(tx, itemId, changes);
      const lines = items.map((i) => (i.id === itemId ? { ...i, ...changes } : i));
      const total = this.totalOrThrow(subtotalOf(lines), current.discount);
      await this.repo.updateCase(tx, id, { total }, userId);
      const params: AuditParams = {
        caseNo: current.caseNo,
        workType: item.workTypeName,
        fields: Object.keys(changes).join(','),
      };
      if (changes.unitPrice !== undefined) {
        params.unitPriceOld = item.unitPrice;
        params.unitPriceNew = changes.unitPrice;
      }
      await this.audit.write(tx, {
        userId,
        action: 'case.line_updated',
        entity: 'case',
        entityId: id,
        params,
      });
    });
    return this.get(id);
  }

  async removeLine(id: number, itemId: number, rowVersion: number, userId: number): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      await lockCurrencyForMoneyWrite(tx);
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      const items = await this.repo.items(tx, id);
      const item = items.find((i) => i.id === itemId);
      if (!item) throw notFound();
      if (items.length === 1) throw err('error.case.last_line', HttpStatus.CONFLICT);

      const remaining = items.filter((i) => i.id !== itemId);
      const total = this.totalOrThrow(subtotalOf(remaining), current.discount);
      await this.repo.deleteItem(tx, itemId);
      await this.repo.updateCase(tx, id, { total }, userId);
      await this.audit.write(tx, {
        userId,
        action: 'case.line_removed',
        entity: 'case',
        entityId: id,
        params: { caseNo: current.caseNo, workType: item.workTypeName, unitPrice: item.unitPrice },
      });
    });
    return this.get(id);
  }

  /**
   * Status change (SPEC §9, owner-approved machine). delivered_date exists only while delivered
   * (addition A): set on delivery (≥ received, ≤ today), cleared otherwise; every delivery date
   * stays in the history.
   */
  async changeStatus(
    id: number,
    rowVersion: number,
    to: CaseStatus,
    note: string | null,
    deliveredDate: string | undefined,
    userId: number,
  ): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      const check = checkTransition(current.status, to);
      if (check === 'same') throw err('error.case.same_status', HttpStatus.CONFLICT);
      if (check === 'invalid') {
        throw err('error.case.invalid_transition', HttpStatus.CONFLICT, { from: current.status, to });
      }
      if (to !== 'delivered' && deliveredDate !== undefined) {
        throw err('error.case.delivered_date_invalid', HttpStatus.BAD_REQUEST);
      }
      let newDeliveredDate: string | null = null;
      if (to === 'delivered') {
        const today = await this.calendar.today(tx);
        newDeliveredDate = deliveredDate ?? today;
        if (newDeliveredDate > today || newDeliveredDate < current.receivedDate) {
          throw err('error.case.delivered_date_invalid', HttpStatus.BAD_REQUEST);
        }
      }
      await this.repo.updateCase(tx, id, { status: to, deliveredDate: newDeliveredDate }, userId);
      await this.repo.insertHistory(tx, id, {
        fromStatus: current.status,
        toStatus: to,
        note,
        deliveredDate: newDeliveredDate,
        userId,
      });
      await this.audit.write(tx, {
        userId,
        action: 'case.status_changed',
        entity: 'case',
        entityId: id,
        params: { caseNo: current.caseNo, from: current.status, to },
      });
    });
    return this.get(id);
  }

  /** Final. Only before delivery; not from "returned" in B2 (revisit with payments, B3). */
  async cancel(id: number, rowVersion: number, reason: string | null, userId: number): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      if (!canCancel(current.status)) {
        throw err('error.case.cannot_cancel', HttpStatus.CONFLICT, { status: current.status });
      }
      await this.repo.updateCase(tx, id, { status: 'cancelled', deliveredDate: null }, userId);
      await this.repo.insertHistory(tx, id, {
        fromStatus: current.status,
        toStatus: 'cancelled',
        note: reason,
        deliveredDate: null,
        userId,
      });
      await this.audit.write(tx, {
        userId,
        action: 'case.cancelled',
        entity: 'case',
        entityId: id,
        params: { caseNo: current.caseNo },
      });
    });
    return this.get(id);
  }

  // ---- helpers ----

  private editable(current: CaseRow): CaseRow {
    if (!canEdit(current.status)) throw err('error.case.cancelled', HttpStatus.CONFLICT);
    return current;
  }

  private checkHeaderDates(receivedDate: string, expectedDate: string, today: string): void {
    if (receivedDate > today) throw err('error.case.received_in_future', HttpStatus.BAD_REQUEST);
    if (expectedDate < receivedDate) throw err('error.case.expected_before_received', HttpStatus.BAD_REQUEST);
  }

  private totalOrThrow(subtotal: number, discount: number): number {
    const total = totalOf(subtotal, discount);
    if (total === null) {
      throw err('error.case.discount_exceeds_subtotal', HttpStatus.CONFLICT, { subtotal, discount });
    }
    return total;
  }

  private async requireActiveTechnician(tx: Tx, id: number): Promise<void> {
    const technician = await this.repo.technician(tx, id);
    if (!technician) throw notFound();
    if (!technician.active) {
      throw err('error.case.technician_inactive', HttpStatus.CONFLICT, { name: technician.name });
    }
  }

  /** Server-side price resolution and snapshots; inactive or unknown work types are refused. */
  private async priceLines(tx: Tx, doctorId: number, lines: LineInput[]): Promise<NewCaseItem[]> {
    const ids = [...new Set(lines.map((l) => l.workTypeId))];
    lines.forEach((line, index) => {
      // Owner decision B2: a line is either on one tooth or on an area — exactly one.
      if ((line.toothNo === undefined) === (line.area === undefined)) {
        throw err('error.case.line_position', HttpStatus.BAD_REQUEST, { line: index + 1 });
      }
    });
    const pricing = new Map((await this.repo.pricingFor(tx, doctorId, ids)).map((p) => [p.id, p]));
    return lines.map((line) => {
      const wt = pricing.get(line.workTypeId);
      if (!wt) throw notFound();
      if (!wt.active) throw err('error.case.work_type_inactive', HttpStatus.CONFLICT, { name: wt.name });
      const price = resolvePrice(wt.generalPrice, wt.specialPrice, line.unitPrice);
      return {
        toothNo: line.toothNo ?? null,
        area: line.area ?? null,
        workTypeId: wt.id,
        workTypeName: wt.name,
        shade: line.shade ?? null,
        unitPrice: price.unitPrice,
        priceSource: price.priceSource,
        note: line.note ?? null,
      };
    });
  }
}
