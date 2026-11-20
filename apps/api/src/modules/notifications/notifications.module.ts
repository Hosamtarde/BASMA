import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsService } from './application/notifications.service';
import { NotificationsRepository } from './infrastructure/notifications.repository';
import { NotificationsController } from './presentation/notifications.controller';

/** The notifications feed and its per-user read / hidden marks (SPEC §5.16, B5). */
@Module({
  imports: [SettingsModule, PaymentsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
