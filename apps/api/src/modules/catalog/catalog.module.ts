import { Module } from '@nestjs/common';
import { ExpenseCategoriesService } from './application/expense-categories.service';
import { TechniciansService } from './application/technicians.service';
import { WorkTypesService } from './application/work-types.service';
import {
  ExpenseCategoriesRepository,
  TechniciansRepository,
  WorkTypesRepository,
} from './infrastructure/catalog.repository';
import {
  ExpenseCategoriesController,
  TechniciansController,
  WorkTypesController,
} from './presentation/catalog.controllers';

/** Lookup lists: technicians, work types, expense categories (SPEC §5.4, §5.9, §12.2). */
@Module({
  controllers: [TechniciansController, WorkTypesController, ExpenseCategoriesController],
  providers: [
    TechniciansService,
    WorkTypesService,
    ExpenseCategoriesService,
    TechniciansRepository,
    WorkTypesRepository,
    ExpenseCategoriesRepository,
  ],
  exports: [ExpenseCategoriesService],
})
export class CatalogModule {}
