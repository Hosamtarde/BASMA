import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { InvoiceTemplateService } from './application/invoice-template.service';
import { InvoicesService } from './application/invoices.service';
import { InvoicesRepository } from './infrastructure/invoices.repository';
import { InvoicesController, InvoiceTemplateController } from './presentation/invoices.controller';

/** Invoices, statements, free invoices and the invoice appearance (SPEC §5.14, §5.15; B6). */
@Module({
  imports: [SettingsModule, PaymentsModule],
  controllers: [InvoicesController, InvoiceTemplateController],
  providers: [InvoicesService, InvoiceTemplateService, InvoicesRepository],
  exports: [InvoicesService, InvoicesRepository],
})
export class InvoicesModule {}
