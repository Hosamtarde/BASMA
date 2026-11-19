import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent } from '../../../shared/db/aggregate';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { LabCalendar } from '../../settings/application/lab-calendar.service';
import { canChequeMove, ChequeStatus, formatVoucher } from '../domain/payment-rules';
import { PaymentsRepository } from '../infrastructure/payments.repository';
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
      if (date > today || date < c.paidAt) throw err('error.cheque.date_invalid', HttpStatus.BAD_REQUEST);
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
}
