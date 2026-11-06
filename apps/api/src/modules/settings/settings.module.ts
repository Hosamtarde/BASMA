import { Module } from '@nestjs/common';
import { LabCalendar } from './application/lab-calendar.service';
import { LogoService } from './application/logo.service';
import { SettingsService } from './application/settings.service';
import { LogoRepository } from './infrastructure/logo.repository';
import { SettingsRepository } from './infrastructure/settings.repository';
import { SettingsController } from './presentation/settings.controller';

/** Lab profile, currency, language, numbering start, logo (SPEC §5.18, §7.7, §12.12). */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository, LogoService, LogoRepository, LabCalendar],
  exports: [SettingsService, LabCalendar],
})
export class SettingsModule {}
