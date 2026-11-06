import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent, changedFields, withUniqueName } from '../../../shared/db/aggregate';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { deleteOrDeactivate, DeleteOutcome } from '../../../shared/db/delete-or-deactivate';
import { notFound } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import { ListQuery, Page } from '../../../shared/http/pagination';
import { I18nService, Language } from '../../../shared/i18n/i18n.service';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DOCTOR_REFUND_CATEGORY,
  seedNameKey,
} from '../domain/expense-category-seed';
import { ExpenseCategoriesRepository, ExpenseCategoryRecord } from '../infrastructure/catalog.repository';

const UNIQUE = 'expense_categories_name_lower_uq';

const systemCategory = () => new DomainError('error.expense_category.system', HttpStatus.CONFLICT);

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: ExpenseCategoriesRepository,
    private readonly audit: AuditWriter,
    private readonly i18n: I18nService,
  ) {}

  async list(q: ListQuery): Promise<Page<ExpenseCategoryRecord>> {
    const { items, total } = await this.repo.list(this.db, q);
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  /** Runs inside first-run setup's transaction; names are frozen in the setup language (SPEC §6.1). */
  async seedDefaults(tx: Tx, language: Language, userId: number): Promise<void> {
    await this.repo.insert(
      tx,
      { name: this.i18n.translate(seedNameKey(DOCTOR_REFUND_CATEGORY), {}, language), isDoctor: true },
      userId,
    );
    for (const code of DEFAULT_EXPENSE_CATEGORIES) {
      await this.repo.insert(
        tx,
        { name: this.i18n.translate(seedNameKey(code), {}, language), isDoctor: false },
        userId,
      );
    }
  }

  create(name: string, userId: number): Promise<ExpenseCategoryRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          const created = await this.repo.insert(tx, { name, isDoctor: false }, userId);
          await this.audit.write(tx, {
            userId,
            action: 'expense_category.created',
            entity: 'expense_category',
            entityId: created.id,
            params: { name },
          });
          return created;
        }),
      UNIQUE,
      'expense_category',
      name,
    );
  }

  update(
    id: number,
    rowVersion: number,
    patch: Partial<Pick<ExpenseCategoryRecord, 'name' | 'active'>>,
    userId: number,
  ): Promise<ExpenseCategoryRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          const current = assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion);
          // The doctor-refund category can be renamed but never switched off.
          if (current.isDoctor && patch.active === false) throw systemCategory();
          const changes = changedFields(current, patch);
          if (Object.keys(changes).length === 0) return current;
          const updated = await this.repo.update(tx, id, changes, userId);
          await this.audit.write(tx, {
            userId,
            action: 'expense_category.updated',
            entity: 'expense_category',
            entityId: id,
            params: { name: updated.name, fields: Object.keys(changes).join(',') },
          });
          return updated;
        }),
      UNIQUE,
      'expense_category',
      patch.name,
    );
  }

  remove(id: number, userId: number): Promise<DeleteOutcome> {
    return this.db.transaction(async (tx) => {
      const current = await this.repo.findForUpdate(tx, id);
      if (!current) throw notFound();
      if (current.isDoctor) throw systemCategory();
      const outcome = await deleteOrDeactivate(
        tx,
        (sp) => this.repo.delete(sp, id),
        async (t) => {
          if (current.active) await this.repo.update(t, id, { active: false }, userId);
        },
      );
      await this.audit.write(tx, {
        userId,
        action: `expense_category.${outcome}`,
        entity: 'expense_category',
        entityId: id,
        params: { name: current.name },
      });
      return outcome;
    });
  }
}
