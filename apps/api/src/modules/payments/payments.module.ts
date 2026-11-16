import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ChequesService } from './application/cheques.service';
import { LedgerService } from './application/ledger.service';
import { PaymentsService } from './application/payments.service';
import { LedgerRepository } from './infrastructure/ledger.repository';
import { PaymentsRepository } from './infrastructure/payments.repository';
import { ChequesController, LedgerController, PaymentsController } from './presentation/payments.controller';

/** Incoming payments, cheques and balances (SPEC §5.8, §5.11, §5.13, §7.3–7.4). */
@Module({
  imports: [SettingsModule],
  controllers: [PaymentsController, ChequesController, LedgerController],
  providers: [PaymentsService, ChequesService, LedgerService, PaymentsRepository, LedgerRepository],
  exports: [PaymentsService, LedgerService, PaymentsRepository, LedgerRepository],
})
export class PaymentsModule {}
