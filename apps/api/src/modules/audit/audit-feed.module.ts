import { Module } from '@nestjs/common';
import { AuditFeedService } from './application/audit-feed.service';
import { AuditFeedRepository } from './infrastructure/audit-feed.repository';
import { AuditFeedController } from './presentation/audit-feed.controller';

/** «آخر العمليات»: a read-only, sanitized view of the audit log (SPEC §5.1, B5b). */
@Module({
  controllers: [AuditFeedController],
  providers: [AuditFeedService, AuditFeedRepository],
})
export class AuditFeedModule {}
