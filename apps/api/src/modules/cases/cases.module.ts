import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { CasesService } from './application/cases.service';
import { CasesRepository } from './infrastructure/cases.repository';
import { CasesController } from './presentation/cases.controller';

/** Cases, lines, price resolution, status machine and history (SPEC §5.3, §5.6, §7.5, §9). */
@Module({
  imports: [SettingsModule],
  controllers: [CasesController],
  providers: [CasesService, CasesRepository],
})
export class CasesModule {}
