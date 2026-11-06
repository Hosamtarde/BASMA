import { Module } from '@nestjs/common';
import { SettingsService } from './application/settings.service';
import { SettingsRepository } from './infrastructure/settings.repository';
import { SettingsController } from './presentation/settings.controller';

/** Lab profile, currency, language, numbering start (SPEC §5.18, §7.7, §12.12). */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
  exports: [SettingsService],
})
export class SettingsModule {}
