import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent } from '../../../shared/db/aggregate';
import { lockCurrencyForMoneyWrite } from '../../../shared/db/currency-guard';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { isUniqueViolation } from '../../../shared/db/pg-errors';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { addDays } from '../../../shared/time/lab-date';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import { CURRENCY, CurrencySetting } from '../../settings/domain/settings-rules';
import { SettingsRepository } from '../../settings/infrastructure/settings.repository';
import {
  allowedChequeStatuses,
  boundRoom,
  CHEQUE_DUE_SOON_DAYS,
  ChequeStatus,
  dueState,
  DueState,
  formatVoucher,
  isCounted,
  PaymentMethod,
  PaymentStatus,
  requestHash,
} from '../domain/payment-rules';
import {
  ChequeRow,
  PaymentFilter,
  PaymentRow,
  PaymentsRepository,
} from '../infrastructure/payments.repository';
import { LedgerService } from './ledger.service';

const err = (code: string, status: HttpStatus, params: Record<string, string | number> = {}) =>
  new DomainError(code, status, params);

export interface ChequeInput {
  chequeNo: string;
  bank: string;
  dueDate: string;
}

export interface PaymentInput {
  doctorId: number;
  caseId?: number | null;
  method: PaymentMethod;
  amount: number;
  /** Default: the lab's today. Never in the future. */
  paidAt?: string;
  notes?: string | null;
  cheque?: ChequeInput;
}

/** An advance payment on a new case: a payment without doctor/case (both come from the case). */
export type AdvancePayment = Omit<PaymentInput, 'doctorId' | 'caseId'>;

export interface ChequeView extends ChequeRow {
  allowedStatuses: ChequeStatus[];
  dueState: DueState;
}

export interface PaymentView extends Omit<PaymentRow, 'cheque'> {
  voucher: string;
  /** Computed by the server (SPEC §7.4) so the UI never re-implements the counting rule. */
  counted: boolean;
  cheque: ChequeView | null;
}

export interface PaymentResult {
  payment: PaymentView;
  doctorBalance: number;
  replayed: boolean;
}

/** What the caller already locked/knows when the payment is created together with a new case. */
export interface AdvanceContext {
  caseId: number;
  caseNo: number;
  caseTotal: number;
}

/**
 * Incoming payments (SPEC §5.8, §7). Every write: currency SHARE lock → doctor row lock →
 * (case row share lock) → voucher counter → one transaction with its audit entry (ADR-0010).
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: PaymentsRepository,
    private readonly ledger: LedgerService,
    private readonly calendar: LabCalendar,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** Decorates rows with what the screens need and the rules say (counted, allowed statuses, due state). */
  async view(rows: PaymentRow[]): Promise<PaymentView[]> {
    const today = await this.calendar.today();
    return rows.map((r) => this.toView(r, today));
  }

  toView(r: PaymentRow, today: string): PaymentView {
    const { cheque, ...rest } = r;
    const soonUntil = addDays(today, CHEQUE_DUE_SOON_DAYS);
    return {
      ...rest,
      voucher: formatVoucher(r.voucherNo),
      counted: isCounted({ status: r.status, method: r.method, chequeStatus: cheque?.status ?? null }),
      cheque: cheque
        ? {
            ...cheque,
            allowedStatuses: allowedChequeStatuses(cheque.status, r.status === 'void'),
            dueState: dueState(
              { status: cheque.status, dueDate: cheque.dueDate, paymentVoid: r.status === 'void' },
              today,
              soonUntil,
            ),
          }
        : null,
    };
  }

  /** The canonical request as the client sent it (an omitted date stays omitted), so a replay always matches. */
  canonicalRequest(input: PaymentInput): Record<string, unknown> {
    return {
      doctorId: input.doctorId,
      caseId: input.caseId ?? null,
      method: input.method,
      amount: input.amount,
      paidAt: input.paidAt ?? null,
      notes: input.notes ?? null,
      cheque: input.cheque ?? null,
    };
  }

  async create(input: PaymentInput, key: string, userId: number): Promise<PaymentResult> {
    const hash = requestHash(this.canonicalRequest(input));
    const replay = await this.replayOf(key, hash);
    if (replay) return replay;

    let id: number;
    try {
      id = await this.db.transaction(async (tx) => {
        await lockCurrencyForMoneyWrite(tx);
        const doctor = await this.repo.lockDoctor(tx, input.doctorId);
        if (!doctor) throw notFound();
        // A concurrent request with the same key may have committed while we waited for the lock.
        const again = await this.repo.byIdempotencyKey(tx, key);
        if (again) return -again.id;
        return this.insert(tx, input, doctor.name, userId, { key, hash });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'payments_idempotency_key_uq')) {
        const raced = await this.replayOf(key, hash);
        if (raced) return raced;
      }
      throw error;
    }
    if (id < 0) {
      const raced = await this.replayOf(key, hash);
      if (raced) return raced;
      throw notFound();
    }
    return this.result(id, false);
  }

  /**
   * Same key + same body → the original; same key + different body → 422. A key already used for an
   * outgoing payment is another request too (B4b: one key names one request across both tables).
   */
  async replayOf(key: string, hash: string): Promise<PaymentResult | undefined> {
    const existing = await this.repo.byIdempotencyKey(this.db, key);
    if (!existing) {
      if (await this.repo.keyUsedByOutgoing(this.db, key)) {
        throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return undefined;
    }
    if (existing.requestHash !== hash)
      throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
    return this.result(existing.id, true);
  }

  /**
   * Inserts the payment (+ cheque + audit) inside the caller's transaction. The caller holds the
   * currency SHARE lock; this locks the doctor row. `advance` is set when the case is being created
   * in the same transaction (its total is known and nothing is bound to it yet). `via` names the
   * flow in the audit entry when it is not a plain payment (B5: a payment taken at delivery).
   */
  async insert(
    tx: Tx,
    input: PaymentInput,
    doctorName: string,
    userId: number,
    idem: { key: string; hash: string } | null,
    advance?: AdvanceContext,
    via?: 'delivery',
  ): Promise<number> {
    const today = await this.calendar.today(tx);
    const paidAt = input.paidAt ?? today;
    if (paidAt > today) throw err('error.payment.date_in_future', HttpStatus.BAD_REQUEST);
    if (input.method === 'cheque' && !input.cheque) {
      throw err('error.payment.cheque_required', HttpStatus.BAD_REQUEST);
    }
    if (input.method !== 'cheque' && input.cheque) {
      throw err('error.payment.cheque_not_allowed', HttpStatus.BAD_REQUEST);
    }

    await this.repo.lockDoctor(tx, input.doctorId);

    let caseNo: number | null = null;
    let caseId: number | null = input.caseId ?? null;
    if (advance) {
      caseId = advance.caseId;
      caseNo = advance.caseNo;
      if (input.amount > advance.caseTotal) {
        throw err('error.payment.exceeds_case_total', HttpStatus.CONFLICT, { max: advance.caseTotal });
      }
    } else if (caseId !== null) {
      const c = await this.repo.lockCase(tx, caseId);
      if (!c) throw notFound();
      if (c.doctorId !== input.doctorId) throw err('error.payment.case_doctor_mismatch', HttpStatus.CONFLICT);
      if (c.status === 'cancelled') {
        throw err('error.payment.case_cancelled', HttpStatus.CONFLICT, { caseNo: c.caseNo });
      }
      caseNo = c.caseNo;
      const room = boundRoom(c.total, await this.repo.boundTotal(tx, caseId));
      if (input.amount > room)
        throw err('error.payment.exceeds_case_total', HttpStatus.CONFLICT, { max: room });
    }

    if (input.cheque && (await this.repo.chequeDuplicate(tx, input.cheque.bank, input.cheque.chequeNo))) {
      throw err('error.cheque.duplicate', HttpStatus.CONFLICT);
    }

    const currency = await this.settings.get<CurrencySetting>(tx, CURRENCY);
    if (!currency) throw new Error('currency setting missing (setup not completed)');
    const voucherNo = await this.repo.takeVoucherNo(tx);
    const id = await this.repo.insertPayment(
      tx,
      {
        voucherNo,
        doctorId: input.doctorId,
        caseId,
        method: input.method,
        amount: input.amount,
        currencyCode: currency.value.code,
        paidAt,
        notes: input.notes ?? null,
        idempotencyKey: idem?.key ?? null,
        requestHash: idem?.hash ?? null,
      },
      userId,
    );
    if (input.cheque) await this.repo.insertCheque(tx, { paymentId: id }, input.cheque, paidAt, userId);
    await this.audit.write(tx, {
      userId,
      action: 'payment.created',
      entity: 'payment',
      entityId: id,
      params: {
        voucherNo: formatVoucher(voucherNo),
        doctor: doctorName,
        method: input.method,
        amount: input.amount,
        caseNo,
        viaAdvance: advance !== undefined,
        ...(via === 'delivery' ? { viaDelivery: true } : {}),
      },
    });
    return id;
  }

  async result(id: number, replayed: boolean): Promise<PaymentResult> {
    const row = await this.repo.find(this.db, id);
    if (!row) throw notFound();
    const [payment] = await this.view([row]);
    return {
      payment: payment as PaymentView,
      doctorBalance: (await this.ledger.balance(row.doctorId)).balance,
      replayed,
    };
  }

  async get(id: number): Promise<{
    payment: PaymentView;
    history: {
      fromStatus: string | null;
      toStatus: string;
      statusDate: string;
      at: Date;
      note: string | null;
    }[];
  }> {
    const row = await this.repo.find(this.db, id);
    if (!row) throw notFound();
    const [payment] = await this.view([row]);
    const history = row.cheque ? await this.repo.chequeHistory(this.db, row.cheque.id) : [];
    return { payment: payment as PaymentView, history };
  }

  async list(f: PaymentFilter, page: number, pageSize: number) {
    const r = await this.repo.list(this.db, f, page, pageSize);
    return {
      items: await this.view(r.items),
      page,
      pageSize,
      total: r.total,
      totals: { counted: r.countedTotal, pendingCheques: r.pendingChequesTotal },
    };
  }

  async receiptsSummary(f: Omit<PaymentFilter, 'status' | 'counted'>) {
    const r = await this.repo.receiptsSummary(this.db, f);
    return { ...r, last: r.last ? { ...r.last, voucherNo: formatVoucher(r.last.voucherNo) } : null, basis: 'effective' as const };
  }

  /** Void, never delete (SPEC §7.6). A cleared cheque may be voided too (D9); it reverses its income. */
  async void(id: number, rowVersion: number, reason: string, userId: number): Promise<PaymentResult> {
    const doctorId = await this.repo.doctorIdOf(this.db, id);
    if (doctorId === undefined) throw notFound();
    await this.db.transaction(async (tx) => {
      await this.repo.lockDoctor(tx, doctorId);
      const current = await this.repo.paymentForUpdate(tx, id);
      if (current && (current.status as PaymentStatus) === 'void') {
        throw err('error.payment.already_void', HttpStatus.CONFLICT);
      }
      const p = assertCurrent(current, rowVersion);
      const chequeStatus = await this.repo.chequeStatusOf(tx, id);
      await this.repo.markVoid(tx, id, reason, userId);
      await this.audit.write(tx, {
        userId,
        action: 'payment.voided',
        entity: 'payment',
        entityId: id,
        params: {
          voucherNo: formatVoucher(p.voucherNo),
          amount: p.amount,
          method: p.method,
          chequeStatus,
          reason,
        },
      });
    });
    return this.result(id, false);
  }

  /** Bound payments of a case with its paid/remaining (SPEC §5.6). */
  async casePayments(caseId: number): Promise<{
    caseId: number;
    total: number;
    paid: number;
    remaining: number;
    payments: PaymentView[];
  }> {
    const c = await this.repo.caseHeader(this.db, caseId);
    if (!c) throw notFound();
    const figures = await this.ledger.caseFigures(c.doctorId, caseId);
    const rows = await this.repo.list(this.db, { caseId }, 1, 100);
    return {
      caseId,
      total: c.total,
      paid: figures?.paid ?? 0,
      remaining: figures?.remaining ?? 0,
      payments: await this.view(rows.items),
    };
  }


}
