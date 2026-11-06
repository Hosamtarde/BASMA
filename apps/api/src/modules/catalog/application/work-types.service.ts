import { Inject, Injectable } from '@nestjs/common';
import { AuditParams, AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent, changedFields, withUniqueName } from '../../../shared/db/aggregate';
import { lockCurrencyForMoneyWrite } from '../../../shared/db/currency-guard';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { deleteOrDeactivate, DeleteOutcome } from '../../../shared/db/delete-or-deactivate';
import { notFound } from '../../../shared/errors/common-errors';
import { ListQuery, Page } from '../../../shared/http/pagination';
import { WorkTypeRecord, WorkTypesRepository } from '../infrastructure/catalog.repository';

const UNIQUE = 'work_types_name_lower_uq';

type WorkTypePatch = Partial<Pick<WorkTypeRecord, 'name' | 'unitPrice' | 'sortOrder' | 'active'>>;

/**
 * Work types = «نوع العمل» with a general price per tooth (SPEC §5.4). The list starts empty:
 * the owner enters their own types and prices (no seed, owner decision B1).
 * Price edits affect only future case lines (lines keep a snapshot, B2).
 */
@Injectable()
export class WorkTypesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: WorkTypesRepository,
    private readonly audit: AuditWriter,
  ) {}

  async list(q: ListQuery): Promise<Page<WorkTypeRecord>> {
    const { items, total } = await this.repo.list(this.db, q);
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  create(
    values: { name: string; unitPrice: number; sortOrder: number },
    userId: number,
  ): Promise<WorkTypeRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          await lockCurrencyForMoneyWrite(tx);
          const created = await this.repo.insert(tx, values, userId);
          await this.audit.write(tx, {
            userId,
            action: 'work_type.created',
            entity: 'work_type',
            entityId: created.id,
            params: { name: created.name, unitPrice: created.unitPrice },
          });
          return created;
        }),
      UNIQUE,
      'work_type',
      values.name,
    );
  }

  update(id: number, rowVersion: number, patch: WorkTypePatch, userId: number): Promise<WorkTypeRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          if (patch.unitPrice !== undefined) await lockCurrencyForMoneyWrite(tx);
          const current = assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion);
          const changes = changedFields(current, patch);
          if (Object.keys(changes).length === 0) return current;
          const updated = await this.repo.update(tx, id, changes, userId);
          const params: AuditParams = { name: updated.name, fields: Object.keys(changes).join(',') };
          if (changes.unitPrice !== undefined) {
            params.unitPriceOld = current.unitPrice;
            params.unitPriceNew = updated.unitPrice;
          }
          await this.audit.write(tx, {
            userId,
            action: 'work_type.updated',
            entity: 'work_type',
            entityId: id,
            params,
          });
          return updated;
        }),
      UNIQUE,
      'work_type',
      patch.name,
    );
  }

  remove(id: number, userId: number): Promise<DeleteOutcome> {
    return this.db.transaction(async (tx) => {
      const current = await this.repo.findForUpdate(tx, id);
      if (!current) throw notFound();
      const outcome = await deleteOrDeactivate(
        tx,
        (sp) => this.repo.delete(sp, id),
        async (t) => {
          if (current.active) await this.repo.update(t, id, { active: false }, userId);
        },
      );
      await this.audit.write(tx, {
        userId,
        action: `work_type.${outcome}`,
        entity: 'work_type',
        entityId: id,
        params: { name: current.name },
      });
      return outcome;
    });
  }
}
