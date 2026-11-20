import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { ExportsService } from './application/exports.service';
import { ExportsController } from './presentation/exports.controller';

/** CSV exports of debts, the breakdown, the statement and payments (SPEC §10). */
@Module({
  imports: [SettingsModule, PaymentsModule, InvoicesModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
