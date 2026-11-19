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
  CHEQUE_DUE_SOON_DAYS,
  ChequeStatus,
  dueState,
  formatVoucher,
  isCounted,
  OutgoingKind,
  PaymentMethod,
  PaymentStatus,
  requestHash,
} from '../domain/payment-rules';
import { OutgoingFilter, OutgoingRepository, OutgoingRow } from '../infrastructure/outgoing.repository';
import { PaymentsRepository } from '../infrastructure/payments.repository';
import { LedgerService } from './ledger.service';
import type { ChequeInput, ChequeView } from './payments.service';

const err = (code: string, status: HttpStatus, params: Record<string, string | number> = {}) =>
  new DomainError(code, status, params);

export interface OutgoingInput {
  categoryId: number;
  /** Expenses: who was paid (free text). Forbidden for a refund. */
  payee?: string | null;
  /** Refunds: the doctor. Forbidden for an expense. */
  doctorId?: number | null;
  method: PaymentMethod;
  amount: number;
  /** Default: the lab's today. Never in the future. */
  paidAt?: string;
  notes?: string | null;
  cheque?: ChequeInput;
}

export interface OutgoingView extends Omit<OutgoingRow, 'cheque'> {
  voucher: string;
  /** SPEC §7.4: cash/transfer at once, a cheque once cleared; void never. */
  counted: boolean;
  /** The day the money counts (payment date, or the day the cheque cleared); null while it does not count. */
  effectiveDate: string | null;
  cheque: ChequeView | null;
}

export interface OutgoingResult {
  payment: OutgoingView;
  /** The doctor's balance after the change (refunds only). */
  doctorBalance: number | null;
  replayed: boolean;
}

/**
 * Outgoing money (B4b, SPEC §5.9, §7): expenses, and refunds of a doctor's credit (`paid_out`).
 * Every write: currency SHARE lock → doctor row (refunds) → category SHARE → OUT- counter → one
 * transaction with its audit entry (ADR-0010; docs/plans/b4b-outgoing-expenses.md §3).
 */
@Injectable()
export class OutgoingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: OutgoingRepository,
    private readonly payments: PaymentsRepository,
    private readonly ledger: LedgerService,
    private readonly calendar: LabCalendar,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditWriter,
  ) {}

  toView(r: OutgoingRow, today: string): OutgoingView {
    const { cheque, ...rest } = r;
    const counted = isCounted({ status: r.status, method: r.method, chequeStatus: cheque?.status ?? null });
    return {
      ...rest,
      voucher: formatVoucher(r.voucherNo, 'out'),
      counted,
      effectiveDate: counted ? (r.method === 'cheque' ? (cheque?.statusDate ?? null) : r.paidAt) : null,
      cheque: cheque
        ? {
            ...cheque,
            allowedStatuses: allowedChequeStatuses(cheque.status, r.status === 'void'),
            dueState: dueState(
              { status: cheque.status, dueDate: cheque.dueDate, paymentVoid: r.status === 'void' },
              today,
              addDays(today, CHEQUE_DUE_SOON_DAYS),
            ),
          }
        : null,
    };
  }

  async view(rows: OutgoingRow[]): Promise<OutgoingView[]> {
    const today = await this.calendar.today();
    return rows.map((r) => this.toView(r, today));
  }

  /** As the client sent it (an omitted date stays omitted), so a replay after midnight still matches. */
  canonicalRequest(input: OutgoingInput): Record<string, unknown> {
    return {
      direction: 'out',
      categoryId: input.categoryId,
      payee: input.payee ?? null,
      doctorId: input.doctorId ?? null,
      method: input.method,
      amount: input.amount,
      paidAt: input.paidAt ?? null,
      notes: input.notes ?? null,
      cheque: input.cheque ?? null,
    };
  }

  /** `mayReadLedger`: a refund shows and moves a doctor's balance, so it also needs `ledger.read` (X10). */
  async create(
    input: OutgoingInput,
    key: string,
    userId: number,
    mayReadLedger: () => boolean = () => true,
  ): Promise<OutgoingResult> {
    const hash = requestHash(this.canonicalRequest(input));
    const replay = await this.replayOf(key, hash);
    if (replay) return replay;

    // `is_doctor` never changes after setup, so the kind is known before any lock.
    const category = await this.repo.category(this.db, input.categoryId);
    if (!category) throw notFound();
    const kind: OutgoingKind = category.isDoctor ? 'doctor_refund' : 'expense';
    if (kind === 'doctor_refund' && !mayReadLedger()) throw err('error.auth.forbidden', HttpStatus.FORBIDDEN);
    this.checkParty(kind, input);

    let id: number;
    try {
      id = await this.db.transaction(async (tx) => {
        await lockCurrencyForMoneyWrite(tx);
        let doctorName: string | null = null;
        if (kind === 'doctor_refund') {
          const doctor = await this.payments.lockDoctor(tx, input.doctorId as number);
          if (!doctor) throw notFound();
          doctorName = doctor.name;
        }
        // A concurrent request with the same key may have committed while we waited for the lock.
        const again = await this.repo.byIdempotencyKey(tx, key);
        if (again) return -again.id;
        return this.insert(tx, input, kind, doctorName, userId, { key, hash });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'outgoing_payments_idempotency_key_uq')) {
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

  private checkParty(kind: OutgoingKind, input: OutgoingInput): void {
    if (kind === 'doctor_refund') {
      if (input.doctorId === undefined || input.doctorId === null) {
        throw err('error.outgoing.doctor_required', HttpStatus.BAD_REQUEST);
      }
      if (input.payee !== undefined && input.payee !== null) {
        throw err('error.outgoing.payee_not_allowed', HttpStatus.BAD_REQUEST);
      }
    } else {
      if (input.payee === undefined || input.payee === null) {
        throw err('error.outgoing.payee_required', HttpStatus.BAD_REQUEST);
      }
      if (input.doctorId !== undefined && input.doctorId !== null) {
        throw err('error.outgoing.doctor_not_allowed', HttpStatus.BAD_REQUEST);
      }
    }
  }

  /** Same key + same body → the original; another body, or a key used by an incoming payment → 422. */
  async replayOf(key: string, hash: string): Promise<OutgoingResult | undefined> {
    const existing = await this.repo.byIdempotencyKey(this.db, key);
    if (!existing) {
      if (await this.payments.keyUsedByIncoming(this.db, key)) {
        throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return undefined;
    }
    if (existing.requestHash !== hash) throw err('error.idempotency.mismatch', HttpStatus.UNPROCESSABLE_ENTITY);
    return this.result(existing.id, true);
  }

  private async insert(
    tx: Tx,
    input: OutgoingInput,
    kind: OutgoingKind,
    doctorName: string | null,
    userId: number,
    idem: { key: string; hash: string },
  ): Promise<number> {
    const today = await this.calendar.today(tx);
    const paidAt = input.paidAt ?? today;
    if (paidAt > today) throw err('error.payment.date_in_future', HttpStatus.BAD_REQUEST);
    if (input.method === 'cheque' && !input.cheque) throw err('error.payment.cheque_required', HttpStatus.BAD_REQUEST);
    if (input.method !== 'cheque' && input.cheque) {
      throw err('error.payment.cheque_not_allowed', HttpStatus.BAD_REQUEST);
    }

    if (kind === 'doctor_refund') {
      // Under the doctor lock: no incoming void, cheque return or other refund can change his credit now.
      const balance = await this.ledger.balance(input.doctorId as number, tx);
      if (input.amount > balance.refundable) {
        throw err('error.outgoing.refund_exceeds_credit', HttpStatus.CONFLICT, { max: balance.refundable });
      }
    }

    const category = await this.repo.lockCategory(tx, input.categoryId);
    if (!category) throw notFound();
    if (!category.active) {
      throw err('error.outgoing.category_inactive', HttpStatus.CONFLICT, { name: category.name });
    }

    if (input.cheque && (await this.payments.chequeDuplicate(tx, input.cheque.bank, input.cheque.chequeNo, 'out'))) {
      throw err('error.cheque.duplicate', HttpStatus.CONFLICT);
    }

    const currency = await this.settings.get<CurrencySetting>(tx, CURRENCY);
    if (!currency) throw new Error('currency setting missing (setup not completed)');
    const voucherNo = await this.repo.takeVoucherNo(tx);
    const id = await this.repo.insert(
      tx,
      {
        voucherNo,
        kind,
        categoryId: input.categoryId,
        doctorId: kind === 'doctor_refund' ? (input.doctorId as number) : null,
        payee: kind === 'expense' ? (input.payee as string) : null,
        method: input.method,
        amount: input.amount,
        currencyCode: currency.value.code,
        paidAt,
        notes: input.notes ?? null,
        idempotencyKey: idem.key,
        requestHash: idem.hash,
      },
      userId,
    );
    if (input.cheque) {
      await this.payments.insertCheque(tx, { outgoingPaymentId: id }, input.cheque, paidAt, userId);
    }
    await this.audit.write(tx, {
      userId,
      action: 'outgoing.created',
      entity: 'outgoing_payment',
      entityId: id,
      params: {
        voucherNo: formatVoucher(voucherNo, 'out'),
        kind,
        category: category.name,
        party: kind === 'doctor_refund' ? (doctorName ?? '') : (input.payee as string),
        method: input.method,
        amount: input.amount,
      },
    });
    return id;
  }

  async result(id: number, replayed: boolean): Promise<OutgoingResult> {
    const row = await this.repo.find(this.db, id);
    if (!row) throw notFound();
    const [payment] = await this.view([row]);
    return {
      payment: payment as OutgoingView,
      doctorBalance: row.doctorId === null ? null : (await this.ledger.balance(row.doctorId)).balance,
      replayed,
    };
  }

  async get(id: number) {
    const row = await this.repo.find(this.db, id);
    if (!row) throw notFound();
    const [payment] = await this.view([row]);
    const history = row.cheque ? await this.repo.chequeHistory(this.db, row.cheque.id) : [];
    return { payment: payment as OutgoingView, history };
  }

  async list(f: OutgoingFilter, page: number, pageSize: number) {
    const r = await this.repo.list(this.db, f, page, pageSize);
    return {
      items: await this.view(r.items),
      page,
      pageSize,
      total: r.total,
      totals: { counted: r.countedTotal, pendingCheques: r.pendingChequesTotal },
    };
  }

  /** Void, never delete (SPEC §7.6). Any cheque status, like B3 D9: voiding a cleared cheque reverses it. */
  async void(id: number, rowVersion: number, reason: string, userId: number): Promise<OutgoingResult> {
    const head = await this.repo.head(this.db, id);
    if (!head) throw notFound();
    await this.db.transaction(async (tx) => {
      if (head.doctorId !== null) await this.payments.lockDoctor(tx, head.doctorId);
      const current = await this.repo.forUpdate(tx, id);
      if (current && (current.status as PaymentStatus) === 'void') {
        throw err('error.outgoing.already_void', HttpStatus.CONFLICT);
      }
      const p = assertCurrent(current, rowVersion);
      const chequeStatus: ChequeStatus | null = await this.repo.chequeStatusOf(tx, id);
      await this.repo.markVoid(tx, id, reason, userId);
      await this.audit.write(tx, {
        userId,
        action: 'outgoing.voided',
        entity: 'outgoing_payment',
        entityId: id,
        params: {
          voucherNo: formatVoucher(p.voucherNo, 'out'),
          kind: p.kind,
          amount: p.amount,
          method: p.method,
          chequeStatus,
          reason,
        },
      });
    });
    return this.result(id, false);
  }
}
