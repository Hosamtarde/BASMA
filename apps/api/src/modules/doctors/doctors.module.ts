import { Module } from '@nestjs/common';
import { DoctorsService } from './application/doctors.service';
import { DoctorsRepository } from './infrastructure/doctors.repository';
import { DoctorsController } from './presentation/doctors.controller';

/** Doctors directory and special prices (SPEC §5.2, §5.12). Balances come with the ledger (B3/B4). */
@Module({
  controllers: [DoctorsController],
  providers: [DoctorsService, DoctorsRepository],
})
export class DoctorsModule {}
