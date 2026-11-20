import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent } from '../../../shared/db/aggregate';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import { addDays } from '../../../shared/time/lab-date';
import {
  canChequeMove,
  CHEQUE_DUE_SOON_DAYS,
  chequeStatusDateValid,
  ChequeStatus,
  formatVoucher,
} from '../domain/payment-rules';
import { ChequeRegisterRepository, RegisterFilter } from '../infrastructure/cheque-register.repository';
import { PaymentsRepository } from '../infrastructure/payments.repository';
import { OutgoingRepository } from '../infrastructure/outgoing.repository';
import { OutgoingResult, OutgoingService } from './outgoing.service';
import { PaymentResult, PaymentsService } from './payments.service';

const err = (code: string, status: HttpStatus, params: Record<string, string | number> = {}) =>
  new DomainError(code, status, params);

/** Cheque register: the only place a cheque's status changes (SPEC §5.13, D3). */
@Injectable()
export class ChequesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: PaymentsRepository,
    private readonly payments: PaymentsService,
    private readonly calendar: LabCalendar,
    private readonly audit: AuditWriter,
    private readonly outgoingRepo: OutgoingRepository,
    private readonly outgoing: OutgoingService,
    private readonly registerRepo: ChequeRegisterRepository,
  ) {}

  async changeStatus(
    id: number,
    rowVersion: number,
    to: ChequeStatus,
    statusDate: string | undefined,
    note: string | null,
    userId: number,
  ): Promise<PaymentResult> {
    const doctorId = await this.repo.doctorIdOfCheque(this.db, id);
    if (doctorId === undefined) throw notFound();
    const paymentId = await this.db.transaction(async (tx) => {
      // Same order as every money write: doctor first, then the row itself (ADR-0010).
      await this.repo.lockDoctor(tx, doctorId);
      const c = assertCurrent(await this.repo.chequeForUpdate(tx, id), rowVersion);
      if (c.paymentStatus === 'void') throw err('error.cheque.payment_void', HttpStatus.CONFLICT);
      const from = c.status as ChequeStatus;
      if (!canChequeMove(from, to)) {
        throw err('error.cheque.invalid_transition', HttpStatus.CONFLICT, { from, to });
      }
      const today = await this.calendar.today(tx);
      const date = statusDate ?? today;
      if (!chequeStatusDateValid(date, today, c.paidAt, c.statusDate)) {
        throw err('error.cheque.date_invalid', HttpStatus.BAD_REQUEST);
      }
      await this.repo.changeChequeStatus(tx, id, from, to, date, note, userId);
      await this.audit.write(tx, {
        userId,
        action: 'cheque.status_changed',
        entity: 'cheque',
        entityId: id,
        params: {
          voucherNo: formatVoucher(c.voucherNo),
          chequeNo: c.chequeNo,
          from,
          to,
          amount: c.amount,
        },
      });
      return c.paymentId as number; // inner join on payments: an incoming cheque
    });
    return this.payments.result(paymentId, false);
  }

  /**
   * Outgoing cheques (B4b): the same state machine (D3) and rules; the lab's own cheque. A refund cheque
   * locks its doctor first (ADR-0010 order), since clearing or returning it moves his balance.
   */
  async changeOutgoingStatus(
    id: number,
    rowVersion: number,
    to: ChequeStatus,
    statusDate: string | undefined,
    note: string | null,
    userId: number,
  ): Promise<OutgoingResult> {
    const head = await this.outgoingRepo.headOfCheque(this.db, id);
    if (head === undefined) throw notFound();
    const outgoingId = await this.db.transaction(async (tx) => {
      if (head.doctorId !== null) await this.repo.lockDoctor(tx, head.doctorId);
      const c = assertCurrent(await this.outgoingRepo.chequeForUpdate(tx, id), rowVersion);
      if (c.paymentStatus === 'void') throw err('error.cheque.payment_void', HttpStatus.CONFLICT);
      const from = c.status as ChequeStatus;
      if (!canChequeMove(from, to)) {
        throw err('error.cheque.invalid_transition', HttpStatus.CONFLICT, { from, to });
      }
      const today = await this.calendar.today(tx);
      const date = statusDate ?? today;
      if (!chequeStatusDateValid(date, today, c.paidAt, c.statusDate)) {
        throw err('error.cheque.date_invalid', HttpStatus.BAD_REQUEST);
      }
      await this.repo.changeChequeStatus(tx, id, from, to, date, note, userId);
      await this.audit.write(tx, {
        userId,
        action: 'cheque.status_changed',
        entity: 'cheque',
        entityId: id,
        params: {
          voucherNo: formatVoucher(c.voucherNo, 'out'),
          chequeNo: c.chequeNo,
          from,
          to,
          amount: c.amount,
          direction: 'out',
        },
      });
      return c.outgoingId;
    });
    return this.outgoing.result(outgoingId, false);
  }

  /**
   * The register over both directions (SPEC §5.13). A caller without `expenses.read` sees incoming
   * cheques only (B4b X10): asking for outgoing ones gives an empty page, not an error.
   */
  async register(f: RegisterFilter, canSeeOutgoing: boolean, page: number, pageSize: number) {
    const today = await this.calendar.today();
    const soonUntil = addDays(today, CHEQUE_DUE_SOON_DAYS);
    if (!canSeeOutgoing && f.direction === 'out') return { items: [], page, pageSize, total: 0, today };
    const direction = canSeeOutgoing ? f.direction : 'in';
    const r = await this.registerRepo.list(this.db, { ...f, direction }, today, soonUntil, page, pageSize);
    return { ...r, page, pageSize, today, soonUntil };
  }

  async registerSummary(f: Omit<RegisterFilter, 'direction' | 'status'>, canSeeOutgoing: boolean) {
    const today = await this.calendar.today();
    return this.registerRepo.summary(
      this.db,
      { ...f, direction: canSeeOutgoing ? 'all' : 'in' },
      today,
      addDays(today, CHEQUE_DUE_SOON_DAYS),
    );
  }
}
