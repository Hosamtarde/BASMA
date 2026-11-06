import { Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent, changedFields, withUniqueName } from '../../../shared/db/aggregate';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { deleteOrDeactivate, DeleteOutcome } from '../../../shared/db/delete-or-deactivate';
import { notFound } from '../../../shared/errors/common-errors';
import { ListQuery, Page } from '../../../shared/http/pagination';
import { TechnicianRecord, TechniciansRepository } from '../infrastructure/catalog.repository';

const UNIQUE = 'technicians_name_lower_uq';

@Injectable()
export class TechniciansService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: TechniciansRepository,
    private readonly audit: AuditWriter,
  ) {}

  async list(q: ListQuery): Promise<Page<TechnicianRecord>> {
    const { items, total } = await this.repo.list(this.db, q);
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  create(name: string, userId: number): Promise<TechnicianRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          const created = await this.repo.insert(tx, name, userId);
          await this.audit.write(tx, {
            userId,
            action: 'technician.created',
            entity: 'technician',
            entityId: created.id,
            params: { name },
          });
          return created;
        }),
      UNIQUE,
      'technician',
      name,
    );
  }

  update(
    id: number,
    rowVersion: number,
    patch: Partial<Pick<TechnicianRecord, 'name' | 'active'>>,
    userId: number,
  ): Promise<TechnicianRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          const current = assertCurrent(await this.repo.findForUpdate(tx, id), rowVersion);
          const changes = changedFields(current, patch);
          if (Object.keys(changes).length === 0) return current;
          const updated = await this.repo.update(tx, id, changes, userId);
          await this.audit.write(tx, {
            userId,
            action: 'technician.updated',
            entity: 'technician',
            entityId: id,
            params: { name: updated.name, fields: Object.keys(changes).join(',') },
          });
          return updated;
        }),
      UNIQUE,
      'technician',
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
        action: `technician.${outcome}`,
        entity: 'technician',
        entityId: id,
        params: { name: current.name },
      });
      return outcome;
    });
  }
}
