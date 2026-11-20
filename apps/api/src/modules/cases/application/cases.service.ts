import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditParams, AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent } from '../../../shared/db/aggregate';
import { lockCurrencyForMoneyWrite } from '../../../shared/db/currency-guard';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { isUniqueViolation } from '../../../shared/db/pg-errors';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import { LedgerService } from '../../payments/application/ledger.service';
import {
  AdvancePayment,
  ChequeInput,
  PaymentResult,
  PaymentsService,
  PaymentView,
} from '../../payments/application/payments.service';
import { boundRoom, PaymentMethod, requestHash } from '../../payments/domain/payment-rules';
import { PaymentsRepository } from '../../payments/infrastructure/payments.repository';
import {
  Area,
  canCancel,
  cancelNeedsReason,
  canEdit,
  CaseCounts,
  CaseStatus,
  checkTransition,
  DEFAULT_INITIAL_STATUS,
  isOverdue,
  MAX_LINES_PER_CASE,
  resolvePrice,
  subtotalOf,
  summarizeCounts,
  totalOf,
} from '../domain/case-rules';
import { collectOnValid, decideDelivery, deliveryDue, DeliveryReceived } from '../domain/delivery-rules';
import { collectPhase } from '../../notifications/domain/notification-rules';
import {
  CaseChanges,
  CaseFilter,
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
  /** Bound payments that count + the FIFO share of unbound ones (SPEC §7.3); 0 when cancelled. */
  paid: number;
  remaining: number;
  /** Payments bound to this case whose cheque has not cleared yet (B5). */
  pendingCheques: number;
  /** What the delivery dialog may still ask for (B5, N1); null when the case cannot be delivered now. */
  deliveryDue: number | null;
  /** «تحصيل مستحق»: delivered, the collect date has come and something is still owed (B5). */
  collectDue: boolean;
  overdue: boolean;
  items: CaseItemRow[];
  history: HistoryRow[];
}

/** A delivery request (SPEC §5.7; B5 plan §4.2). The amount of a full payment comes from the server. */
export interface DeliveryInput {
  rowVersion: number;
  deliveredDate?: string;
  note?: string | null;
  received?: DeliveryReceived;
  amount?: number;
  method?: PaymentMethod;
  cheque?: ChequeInput;
  collectOn?: string;
}

export interface DeliveryResult {
  detail: CaseDetail;
  payment: PaymentResult | null;
  replayed: boolean;
}

/** Result of creating a case: the case, its advance payment (if any) and whether it was a replay. */
export interface CreatedCase {
  detail: CaseDetail;
  advance: PaymentView | null;
  replayed: boolean;
}

export interface CaseSummary extends CaseRow {
  overdue: boolean;
}

/** A list row; paid / remaining are null when the caller may not read the ledger (B4). */
export interface CaseListItem extends CaseSummary {
  paid: number | null;
  remaining: number | null;
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
    private readonly payments: PaymentsService,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly ledger: LedgerService,
  ) {}

  async list(
    q: CaseListQuery,
    withFigures = false,
  ): Promise<{ items: CaseListItem[]; page: number; pageSize: number; total: number }> {
    const today = await this.calendar.today();
    const { items, total } = await this.repo.list(this.db, q, today);
    // One batch for the whole page (four statements however many rows), never one per row.
    const figures = withFigures ? await this.ledger.figuresForCases(items) : undefined;
    return {
      items: items.map((c) => ({
        ...c,
        overdue: isOverdue(c, today),
        paid: figures ? (figures.get(c.id)?.paid ?? 0) : null,
        remaining: figures ? (figures.get(c.id)?.remaining ?? 0) : null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  /** Cases per status and overdue, one snapshot, same filters and lab-today rule as the list. */
  async counts(filter: CaseFilter): Promise<CaseCounts> {
    const today = await this.calendar.today();
    return summarizeCounts(await this.repo.countByStatus(this.db, filter, today));
  }

  async get(id: number): Promise<CaseDetail> {
    const found = await this.repo.find(this.db, id);
    if (!found) throw notFound();
    const [items, history, today] = await Promise.all([
      this.repo.items(this.db, id),
      this.repo.history(this.db, id),
      this.calendar.today(),
    ]);
    const figures =
      found.status === 'cancelled' ? undefined : await this.ledger.caseFigures(found.doctorId, id);
    const pendingCheques = await this.paymentsRepo.pendingBoundCheques(this.db, id);
    const deliverable = found.status !== 'cancelled' && found.status !== 'delivered';
    return {
      ...found,
      subtotal: subtotalOf(items),
      paid: figures?.paid ?? 0,
      remaining: figures?.remaining ?? 0,
      pendingCheques,
      deliveryDue: deliverable
        ? deliveryDue(
            figures?.remaining ?? 0,
            pendingCheques,
            boundRoom(found.total, await this.paymentsRepo.boundTotal(this.db, id)),
          )
        : null,
      collectDue:
        found.status === 'delivered' &&
        found.collectOn !== null &&
        collectPhase(found.collectOn, today, figures?.remaining ?? 0) !== null,
      overdue: isOverdue(found, today),
      items,
      history,
    };
  }

  /**
   * Creates a case; with `advance` the payment is created in the SAME transaction and bound to the
   * case (SPEC §5.3), under the caller's Idempotency-Key. A replay returns the original case.
   */
  async create(
    input: NewCase,
    userId: number,
    advance?: { payment: AdvancePayment; key: string },
  ): Promise<CreatedCase> {
    let hash = '';
    if (advance) {
      // The request as sent (omitted dates stay omitted), so a replay after midnight still matches.
      hash = requestHash({ ...input, advance: advance.payment });
      const replay = await this.replayOf(advance.key, hash);
      if (replay) return replay;
    }
    let id: number;
    try {
      id = await this.createInTx(input, userId, advance && { ...advance, hash });
    } catch (error) {
      if (advance && isUniqueViolation(error, 'payments_idempotency_key_uq')) {
        const raced = await this.replayOf(advance.key, hash);
        if (raced) return raced;
      }
      throw error;
    }
    if (id < 0) {
      const raced = advance && (await this.replayOf(advance.key, hash));
      if (raced) return raced;
      throw notFound();
    }
    return { detail: await this.get(id), advance: await this.advanceOf(id), replayed: false };
  }

  private async replayOf(key: string, hash: string): Promise<CreatedCase | undefined> {
    const existing = await this.paymentsRepo.byIdempotencyKey(this.db, key);
    if (!existing) {
      // A key already used for an outgoing payment names another request (B4b).
      if (await this.paymentsRepo.keyUsedByOutgoing(this.db, key)) {
        throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return undefined;
    }
    if (existing.requestHash !== hash || existing.caseId === null) {
      throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return {
      detail: await this.get(existing.caseId),
      advance: await this.advanceOf(existing.caseId),
      replayed: true,
    };
  }

  private async advanceOf(caseId: number): Promise<PaymentView | null> {
    const rows = await this.paymentsRepo.list(this.db, { caseId }, 1, 1);
    const first = rows.items[0];
    return first ? ((await this.payments.view([first]))[0] ?? null) : null;
  }

  /** Returns the new case id, or minus the id of an earlier case when the key won a race. */
  private async createInTx(
    input: NewCase,
    userId: number,
    advance?: { payment: AdvancePayment; key: string; hash: string },
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      await lockCurrencyForMoneyWrite(tx);
      // Same lock order as a plain payment (ADR-0010): currency → doctor → counters.
      if (advance) {
        await this.paymentsRepo.lockDoctor(tx, input.doctorId);
        const earlier = await this.paymentsRepo.byIdempotencyKey(tx, advance.key);
        if (earlier?.caseId) return -earlier.caseId;
      }
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
      if (advance) {
        await this.payments.insert(
          tx,
          { ...advance.payment, doctorId: input.doctorId },
          doctor.name,
          userId,
          { key: advance.key, hash: advance.hash },
          { caseId, caseNo, caseTotal: total },
        );
      }
      return caseId;
    });
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
   * Status change (SPEC §9, owner-approved machine) for every move except delivery: a case is
   * delivered only through `deliver` (B5, N3), which asks about the money. Leaving "delivered"
   * (→ returned) clears delivered_date and the collect date; every delivery date stays in the history.
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
      if (to === 'delivered') {
        if (current.status === 'delivered') throw err('error.case.already_delivered', HttpStatus.CONFLICT);
        throw err('error.case.delivery_required', HttpStatus.CONFLICT);
      }
      const check = checkTransition(current.status, to);
      if (check === 'same') throw err('error.case.same_status', HttpStatus.CONFLICT);
      if (check === 'invalid') {
        throw err('error.case.invalid_transition', HttpStatus.CONFLICT, { from: current.status, to });
      }
      if (deliveredDate !== undefined) throw err('error.case.delivered_date_invalid', HttpStatus.BAD_REQUEST);
      await this.repo.updateCase(tx, id, { status: to, deliveredDate: null, collectOn: null }, userId);
      await this.repo.insertHistory(tx, id, {
        fromStatus: current.status,
        toStatus: to,
        note,
        deliveredDate: null,
        userId,
      });
      const params: AuditParams = { caseNo: current.caseNo, from: current.status, to };
      // The collect date is not in the history: keep the one a return clears in the audit entry.
      if (current.collectOn !== null) params.collectOn = current.collectOn;
      await this.audit.write(tx, { userId, action: 'case.status_changed', entity: 'case', entityId: id, params });
    });
    return this.get(id);
  }

  /**
   * Delivery (SPEC §5.7, §9; B5 plan §4): the only way to "delivered". In ONE transaction, under the
   * ADR-0010 lock order (currency SHARE when money is taken → doctor → case → voucher counter): the
   * amount due is computed under the locks, the case moves to delivered with its delivery and collect
   * dates, and the payment taken at delivery is created by the same code as any payment (bound to the
   * case, under the caller's Idempotency-Key). Any failure rolls back everything, numbers included.
   */
  async deliver(id: number, input: DeliveryInput, key: string | undefined, userId: number): Promise<DeliveryResult> {
    const hash = key ? requestHash({ caseId: id, ...input }) : '';
    if (key) {
      const replay = await this.deliveryReplay(id, key, hash);
      if (replay) return replay;
    }
    const found = await this.repo.find(this.db, id);
    if (!found) throw notFound();
    let paymentId: number | null;
    try {
      paymentId = await this.db.transaction(async (tx) => {
        const paying = input.received === 'full' || input.received === 'partial';
        if (paying) await lockCurrencyForMoneyWrite(tx);
        const doctor = await this.paymentsRepo.lockDoctor(tx, found.doctorId);
        if (!doctor) throw notFound();
        if (key) {
          // The same key may have committed while we waited for the doctor lock.
          const earlier = await this.paymentsRepo.byIdempotencyKey(tx, key);
          if (earlier) return -earlier.id;
        }
        const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), input.rowVersion));
        if (current.status === 'delivered') throw err('error.case.already_delivered', HttpStatus.CONFLICT);
        if (checkTransition(current.status, 'delivered') !== 'ok') {
          throw err('error.case.invalid_transition', HttpStatus.CONFLICT, { from: current.status, to: 'delivered' });
        }
        const today = await this.calendar.today(tx);
        const deliveredDate = input.deliveredDate ?? today;
        if (deliveredDate > today || deliveredDate < current.receivedDate) {
          throw err('error.case.delivered_date_invalid', HttpStatus.BAD_REQUEST);
        }
        const figures = await this.ledger.caseFigures(current.doctorId, id, tx);
        const due = deliveryDue(
          figures?.remaining ?? 0,
          await this.paymentsRepo.pendingBoundCheques(tx, id),
          boundRoom(current.total, await this.paymentsRepo.boundTotal(tx, id)),
        );
        const verdict = decideDelivery(input, due, deliveredDate);
        if (!verdict.ok) throw err(verdict.code, verdict.status, verdict.params ?? {});

        await this.repo.updateCase(tx, id, { status: 'delivered', deliveredDate, collectOn: verdict.collectOn }, userId);
        await this.repo.insertHistory(tx, id, {
          fromStatus: current.status,
          toStatus: 'delivered',
          note: input.note ?? null,
          deliveredDate,
          userId,
        });
        const params: AuditParams = {
          caseNo: current.caseNo,
          from: current.status,
          deliveredDate,
          received: due === 0 ? 'nothing_due' : (input.received ?? null),
        };
        if (verdict.collectOn !== null) params.collectOn = verdict.collectOn;
        await this.audit.write(tx, { userId, action: 'case.delivered', entity: 'case', entityId: id, params });
        if (verdict.paymentAmount === 0) return null;
        return this.payments.insert(
          tx,
          {
            doctorId: current.doctorId,
            caseId: id,
            method: input.method as PaymentMethod,
            amount: verdict.paymentAmount,
            // Money handed over at delivery is received on the delivery date.
            paidAt: deliveredDate,
            ...(input.cheque ? { cheque: input.cheque } : {}),
          },
          doctor.name,
          userId,
          key ? { key, hash } : null,
          undefined,
          'delivery',
        );
      });
    } catch (error) {
      if (key && isUniqueViolation(error, 'payments_idempotency_key_uq')) {
        const raced = await this.deliveryReplay(id, key, hash);
        if (raced) return raced;
      }
      throw error;
    }
    if (paymentId !== null && paymentId < 0) {
      const raced = key ? await this.deliveryReplay(id, key, hash) : undefined;
      if (raced) return raced;
      throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return {
      detail: await this.get(id),
      payment: paymentId === null ? null : await this.payments.result(paymentId, false),
      replayed: false,
    };
  }

  /** Same key + same delivery → the original answer; the key used for anything else → 422. */
  private async deliveryReplay(id: number, key: string, hash: string): Promise<DeliveryResult | undefined> {
    const existing = await this.paymentsRepo.byIdempotencyKey(this.db, key);
    if (!existing) {
      if (await this.paymentsRepo.keyUsedByOutgoing(this.db, key)) {
        throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return undefined;
    }
    if (existing.requestHash !== hash || existing.caseId !== id) {
      throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return { detail: await this.get(id), payment: await this.payments.result(existing.id, true), replayed: true };
  }

  /** Changes or removes the collect date of a delivered case (B5, N2). */
  async setCollectOn(id: number, rowVersion: number, collectOn: string | null, userId: number): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      if (current.status !== 'delivered' || current.deliveredDate === null) {
        throw err('error.case.not_delivered', HttpStatus.CONFLICT);
      }
      if (collectOn !== null && !collectOnValid(collectOn, current.deliveredDate)) {
        throw err('error.delivery.collect_on_invalid', HttpStatus.BAD_REQUEST);
      }
      if (collectOn === current.collectOn) return;
      await this.repo.updateCase(tx, id, { collectOn }, userId);
      await this.audit.write(tx, {
        userId,
        action: 'case.collect_on_changed',
        entity: 'case',
        entityId: id,
        params: { caseNo: current.caseNo, old: current.collectOn, new: collectOn },
      });
    });
    return this.get(id);
  }

  /** Final. Before delivery, or from "returned" with a reason (D2). Bound payments stay as account credit. */
  async cancel(id: number, rowVersion: number, reason: string | null, userId: number): Promise<CaseDetail> {
    await this.db.transaction(async (tx) => {
      const current = this.editable(assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion));
      if (!canCancel(current.status)) {
        throw err('error.case.cannot_cancel', HttpStatus.CONFLICT, { status: current.status });
      }
      if (cancelNeedsReason(current.status) && !reason?.trim()) {
        throw err('error.case.reason_required', HttpStatus.BAD_REQUEST);
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
        params: {
          caseNo: current.caseNo,
          fromStatus: current.status,
          total: current.total,
          boundPayments: await this.ledger.boundActiveTotal(id, tx),
        },
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
