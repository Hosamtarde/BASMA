import { Global, Injectable, Module } from '@nestjs/common';
import { Tx } from '../db/database';
import { auditLog } from '../db/schema';

export type AuditParams = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  /** Acting user; null only for system actions. */
  userId: number | null;
  /** Stable code, rendered per language on read via catalog key `audit.<action>`. */
  action: string;
  entity?: string;
  entityId?: string | number;
  /** Never secrets (passwords, tokens) and no personal data beyond what the screen shows. */
  params?: AuditParams;
}

/**
 * Writes audit rows inside the CALLER's transaction, so the audit entry and the change
 * it describes are committed (or rolled back) together.
 */
@Injectable()
export class AuditWriter {
  async write(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId === undefined ? null : String(entry.entityId),
      params: entry.params ?? {},
    });
  }
}

@Global()
@Module({ providers: [AuditWriter], exports: [AuditWriter] })
export class AuditModule {}
