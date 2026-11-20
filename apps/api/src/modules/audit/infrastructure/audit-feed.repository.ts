import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../../shared/db/database';
import { auditLog, users } from '../../../shared/db/schema';

export interface AuditFeedRow {
  at: Date;
  action: string;
  entity: string | null;
  params: Record<string, unknown>;
  actor: string | null;
}

@Injectable()
export class AuditFeedRepository {
  /** The latest entries with the actor's user name: one statement, newest first. */
  async latest(db: Database, limit: number): Promise<AuditFeedRow[]> {
    const rows = await db
      .select({
        at: auditLog.at,
        action: auditLog.action,
        entity: auditLog.entity,
        params: auditLog.params,
        actor: users.username,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);
    return rows.map((r) => ({ ...r, params: (r.params ?? {}) as Record<string, unknown> }));
  }
}
