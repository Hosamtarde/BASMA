import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { detectLogoType, MAX_LOGO_BYTES } from '../domain/logo';
import { LogoFile, LogoMeta, LogoRepository } from '../infrastructure/logo.repository';

/**
 * The lab logo is stored in the database (owner decision B1) so every backup contains it.
 * Without a stored logo, clients show the lab name only; never the vendor's logo (SPEC §2.3).
 */
@Injectable()
export class LogoService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: LogoRepository,
    private readonly audit: AuditWriter,
  ) {}

  meta(): Promise<LogoMeta | undefined> {
    return this.repo.meta(this.db);
  }

  async file(): Promise<LogoFile> {
    const logo = await this.repo.file(this.db);
    if (!logo) throw notFound();
    return logo;
  }

  async save(content: Buffer | undefined, userId: number): Promise<LogoMeta> {
    if (!content || content.length === 0) {
      throw new DomainError('error.logo.missing', HttpStatus.BAD_REQUEST);
    }
    // Multer enforces the same limit while receiving; this guards direct callers.
    if (content.length > MAX_LOGO_BYTES) {
      throw new DomainError('error.payload_too_large', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const mimeType = detectLogoType(content);
    if (!mimeType) {
      throw new DomainError('error.logo.invalid_type', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    await this.db.transaction(async (tx) => {
      await this.repo.save(tx, { content, mimeType, sizeBytes: content.length, sha256 }, userId);
      await this.audit.write(tx, {
        userId,
        action: 'settings.logo_updated',
        entity: 'settings',
        entityId: 'logo',
        params: { mimeType, sizeBytes: content.length },
      });
    });
    const saved = await this.meta();
    if (!saved) throw new Error('logo missing right after save');
    return saved;
  }

  /** Back to no logo (lab name only). Idempotent. */
  async remove(userId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (await this.repo.delete(tx)) {
        await this.audit.write(tx, {
          userId,
          action: 'settings.logo_removed',
          entity: 'settings',
          entityId: 'logo',
        });
      }
    });
  }
}
