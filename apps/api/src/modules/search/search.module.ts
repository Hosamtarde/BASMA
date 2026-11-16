import { Module } from '@nestjs/common';
import { SearchService } from './application/search.service';
import { SearchRepository } from './infrastructure/search.repository';
import { SearchController } from './presentation/search.controller';

/** Global search across doctors, cases and payments (SPEC §5.17). */
@Module({
  controllers: [SearchController],
  providers: [SearchService, SearchRepository],
})
export class SearchModule {}
