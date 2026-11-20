import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { AUDIT_FEED_SIZE, auditEntity } from '../domain/audit-feed-rules';
import { AuditFeedRepository } from '../infrastructure/audit-feed.repository';

export interface AuditFeedItem {
  at: string;
  action: string;
  entityType: string;
  entityLabel: string | null;
  actor: string | null;
}

@Injectable()
export class AuditFeedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: AuditFeedRepository,
  ) {}

  async recent(): Promise<AuditFeedItem[]> {
    const rows = await this.repo.latest(this.db, AUDIT_FEED_SIZE);
    return rows.map((r) => ({
      at: r.at.toISOString(),
      action: r.action,
      ...auditEntity(r.action, r.entity, r.params),
      actor: r.actor,
    }));
  }
}
