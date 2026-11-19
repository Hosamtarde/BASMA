import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ChequesService } from './application/cheques.service';
import { LedgerService } from './application/ledger.service';
import { OutgoingService } from './application/outgoing.service';
import { PaymentsService } from './application/payments.service';
import { ChequeRegisterRepository } from './infrastructure/cheque-register.repository';
import { LedgerRepository } from './infrastructure/ledger.repository';
import { OutgoingRepository } from './infrastructure/outgoing.repository';
import { PaymentsRepository } from './infrastructure/payments.repository';
import {
  ChequeRegisterController,
  OutgoingChequesController,
  OutgoingPaymentsController,
} from './presentation/outgoing.controller';
import { ChequesController, LedgerController, PaymentsController } from './presentation/payments.controller';

/**
 * Incoming payments, cheques and balances (SPEC §5.8, §5.11, §5.13, §7.3–7.4) and, since B4b, outgoing
 * payments (expenses and refunds, SPEC §5.9) — one module because refunds are part of the ledger.
 */
@Module({
  imports: [SettingsModule],
  controllers: [
    PaymentsController,
    // Before ChequesController so /cheques/register is never matched by a /cheques/:id route.
    ChequeRegisterController,
    ChequesController,
    OutgoingPaymentsController,
    OutgoingChequesController,
    LedgerController,
  ],
  providers: [
    PaymentsService,
    ChequesService,
    LedgerService,
    OutgoingService,
    PaymentsRepository,
    LedgerRepository,
    OutgoingRepository,
    ChequeRegisterRepository,
  ],
  exports: [PaymentsService, LedgerService, OutgoingService, PaymentsRepository, LedgerRepository, OutgoingRepository],
})
export class PaymentsModule {}
