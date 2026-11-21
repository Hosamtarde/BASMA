import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DEFAULT_INVOICE_TEMPLATE, InvoiceTemplate, validateInvoiceTemplate } from '@app/shared';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { isUniqueViolation } from '../../../shared/db/pg-errors';
import { staleVersion } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { SettingsRepository } from '../../settings/infrastructure/settings.repository';
import { INVOICE_TEMPLATE } from '../domain/invoice-rules';

export interface StoredTemplate {
  template: InvoiceTemplate;
  /** 0 = never saved: the defaults apply and the first save inserts the row. */
  rowVersion: number;
}

/**
 * «مظهر الفاتورة» (SPEC §5.15, plan §5). One `settings` row, validated as a whole by the shared strict validator
 * (unknown keys refused, colours hex only, numbers in range, footer plain text). Nothing stored here can carry
 * HTML, CSS or a URL; the renderer turns it into CSS custom properties and escaped text only.
 */
@Injectable()
export class InvoiceTemplateService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** The stored template, or the defaults. A stored value that no longer validates falls back to the defaults. */
  async get(db: Database | Tx = this.db): Promise<StoredTemplate> {
    const row = await this.settings.get<unknown>(db, INVOICE_TEMPLATE);
    if (!row) return { template: DEFAULT_INVOICE_TEMPLATE, rowVersion: 0 };
    const v = validateInvoiceTemplate(row.value);
    return { template: v.ok ? v.template : DEFAULT_INVOICE_TEMPLATE, rowVersion: row.rowVersion };
  }

  async save(rowVersion: number, value: unknown, userId: number): Promise<StoredTemplate> {
    const v = validateInvoiceTemplate(value);
    if (!v.ok) {
      throw new DomainError('error.validation.failed', HttpStatus.BAD_REQUEST, {}, {
        fields: v.errors.map((e) => ({ field: `template.${e.field}`, constraints: [e.code] })),
      });
    }
    try {
      await this.db.transaction(async (tx) => {
        const current = await this.settings.get<unknown>(tx, INVOICE_TEMPLATE, true);
        if ((current?.rowVersion ?? 0) !== rowVersion) throw staleVersion();
        const before = current ? validateInvoiceTemplate(current.value) : { ok: true as const, template: DEFAULT_INVOICE_TEMPLATE };
        const old = before.ok ? before.template : DEFAULT_INVOICE_TEMPLATE;
        if (current) await this.settings.update(tx, INVOICE_TEMPLATE, v.template, userId);
        else await this.settings.insert(tx, INVOICE_TEMPLATE, v.template, userId);
        const changed = (Object.keys(v.template) as (keyof InvoiceTemplate)[])
          .filter((k) => JSON.stringify(v.template[k]) !== JSON.stringify(old[k]))
          .join(',');
        await this.audit.write(tx, {
          userId,
          action: 'invoice_template.updated',
          entity: 'settings',
          entityId: INVOICE_TEMPLATE,
          params: { changed },
        });
      });
    } catch (error) {
      // Two first saves at once: the loser's insert hits the primary key — the same as a stale version.
      if (isUniqueViolation(error, 'settings_pkey')) throw staleVersion();
      throw error;
    }
    return this.get();
  }
}
