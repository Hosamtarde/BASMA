import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { labLogo } from '../../../shared/db/schema';
import type { LogoMimeType } from '../domain/logo';

type Executor = Database | Tx;

export interface LogoMeta {
  mimeType: LogoMimeType;
  sizeBytes: number;
  sha256: string;
  updatedAt: Date;
}

export interface LogoFile extends LogoMeta {
  content: Buffer;
}

const LOGO_ID = 1;

const metaCols = {
  mimeType: labLogo.mimeType,
  sizeBytes: labLogo.sizeBytes,
  sha256: labLogo.sha256,
  updatedAt: labLogo.updatedAt,
};

@Injectable()
export class LogoRepository {
  async meta(db: Executor): Promise<LogoMeta | undefined> {
    const [row] = await db.select(metaCols).from(labLogo).where(eq(labLogo.id, LOGO_ID));
    return row ? { ...row, mimeType: row.mimeType as LogoMimeType } : undefined;
  }

  async file(db: Executor): Promise<LogoFile | undefined> {
    const [row] = await db
      .select({ ...metaCols, content: labLogo.content })
      .from(labLogo)
      .where(eq(labLogo.id, LOGO_ID));
    return row ? { ...row, mimeType: row.mimeType as LogoMimeType } : undefined;
  }

  async save(
    tx: Tx,
    logo: { content: Buffer; mimeType: LogoMimeType; sizeBytes: number; sha256: string },
    userId: number,
  ): Promise<void> {
    const values = { ...logo, updatedAt: new Date(), updatedBy: userId };
    await tx
      .insert(labLogo)
      .values({ id: LOGO_ID, ...values })
      .onConflictDoUpdate({ target: labLogo.id, set: values });
  }

  /** Returns true when a logo existed. */
  async delete(tx: Tx): Promise<boolean> {
    const rows = await tx.delete(labLogo).where(eq(labLogo.id, LOGO_ID)).returning({ id: labLogo.id });
    return rows.length > 0;
  }
}
