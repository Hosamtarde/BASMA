import { Inject, Injectable } from '@nestjs/common';
import { AuditParams, AuditWriter } from '../../../shared/audit/audit-writer';
import { assertCurrent, changedFields, withUniqueName } from '../../../shared/db/aggregate';
import { lockCurrencyForMoneyWrite } from '../../../shared/db/currency-guard';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { deleteOrDeactivate, DeleteOutcome } from '../../../shared/db/delete-or-deactivate';
import { notFound } from '../../../shared/errors/common-errors';
import { ListQuery, Page } from '../../../shared/http/pagination';
import { mayHardDelete } from '../domain/doctor-rules';
import {
  DoctorChanges,
  DoctorPriceRow,
  DoctorRecord,
  DoctorsRepository,
} from '../infrastructure/doctors.repository';

const UNIQUE = 'doctors_name_lower_uq';

export type NewDoctor = Pick<DoctorRecord, 'name' | 'phone' | 'clinic' | 'notes' | 'openingBalance'>;

@Injectable()
export class DoctorsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: DoctorsRepository,
    private readonly audit: AuditWriter,
  ) {}

  async list(q: ListQuery): Promise<Page<DoctorRecord>> {
    const { items, total } = await this.repo.list(this.db, q);
    return { items, page: q.page, pageSize: q.pageSize, total };
  }

  async get(id: number): Promise<DoctorRecord> {
    const doctor = await this.repo.findById(this.db, id);
    if (!doctor) throw notFound();
    return doctor;
  }

  create(values: NewDoctor, userId: number): Promise<DoctorRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          await lockCurrencyForMoneyWrite(tx);
          const created = await this.repo.insert(tx, values, userId);
          await this.audit.write(tx, {
            userId,
            action: 'doctor.created',
            entity: 'doctor',
            entityId: created.id,
            params: { name: created.name, openingBalance: created.openingBalance },
          });
          return created;
        }),
      UNIQUE,
      'doctor',
      values.name,
    );
  }

  /** The opening balance stays editable (owner decision B1); old and new values are audited. */
  update(id: number, rowVersion: number, patch: DoctorChanges, userId: number): Promise<DoctorRecord> {
    return withUniqueName(
      () =>
        this.db.transaction(async (tx) => {
          if (patch.openingBalance !== undefined) await lockCurrencyForMoneyWrite(tx);
          const current = assertCurrent(await this.repo.findById(tx, id, true), rowVersion);
          const changes = changedFields(current, patch);
          if (Object.keys(changes).length === 0) return current;
          const updated = await this.repo.update(tx, id, changes, userId);
          const params: AuditParams = { name: updated.name, fields: Object.keys(changes).join(',') };
          if (changes.openingBalance !== undefined) {
            params.openingBalanceOld = current.openingBalance;
            params.openingBalanceNew = updated.openingBalance;
          }
          await this.audit.write(tx, {
            userId,
            action: 'doctor.updated',
            entity: 'doctor',
            entityId: id,
            params,
          });
          return updated;
        }),
      UNIQUE,
      'doctor',
      patch.name,
    );
  }

  remove(id: number, userId: number): Promise<DeleteOutcome> {
    return this.db.transaction(async (tx) => {
      const current = await this.repo.findById(tx, id, true);
      if (!current) throw notFound();
      const deactivate = async (t: Tx) => {
        if (current.active) await this.repo.update(t, id, { active: false }, userId);
      };
      let outcome: DeleteOutcome;
      if (mayHardDelete(current)) {
        outcome = await deleteOrDeactivate(tx, (sp) => this.repo.delete(sp, id), deactivate);
      } else {
        await deactivate(tx);
        outcome = 'deactivated';
      }
      await this.audit.write(tx, {
        userId,
        action: `doctor.${outcome}`,
        entity: 'doctor',
        entityId: id,
        params: { name: current.name },
      });
      return outcome;
    });
  }

  async listPrices(doctorId: number): Promise<DoctorPriceRow[]> {
    await this.get(doctorId);
    return this.repo.listPrices(this.db, doctorId);
  }

  /** Sets this doctor's special price for a work type (SPEC §5.12). Used only for new case lines. */
  async setPrice(
    doctorId: number,
    workTypeId: number,
    price: number,
    userId: number,
  ): Promise<DoctorPriceRow> {
    await this.db.transaction(async (tx) => {
      await lockCurrencyForMoneyWrite(tx);
      const { doctor, workType } = await this.requireBoth(tx, doctorId, workTypeId);
      const old = await this.repo.findPriceForUpdate(tx, doctorId, workTypeId);
      if (old === price) return;
      await this.repo.upsertPrice(tx, doctorId, workTypeId, price, userId);
      await this.audit.write(tx, {
        userId,
        action: 'doctor.price_set',
        entity: 'doctor',
        entityId: doctorId,
        params: { name: doctor.name, workType: workType.name, priceOld: old ?? null, priceNew: price },
      });
    });
    return this.priceRow(doctorId, workTypeId);
  }

  /** Back to the general price. Idempotent. */
  async removePrice(doctorId: number, workTypeId: number, userId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { doctor, workType } = await this.requireBoth(tx, doctorId, workTypeId);
      const old = await this.repo.findPriceForUpdate(tx, doctorId, workTypeId);
      if (old === undefined) return;
      await this.repo.deletePrice(tx, doctorId, workTypeId);
      await this.audit.write(tx, {
        userId,
        action: 'doctor.price_removed',
        entity: 'doctor',
        entityId: doctorId,
        params: { name: doctor.name, workType: workType.name, priceOld: old },
      });
    });
  }

  private async requireBoth(tx: Tx, doctorId: number, workTypeId: number) {
    const doctor = await this.repo.findById(tx, doctorId);
    const workType = await this.repo.findWorkType(tx, workTypeId);
    if (!doctor || !workType) throw notFound();
    return { doctor, workType };
  }

  private async priceRow(doctorId: number, workTypeId: number): Promise<DoctorPriceRow> {
    const rows = await this.repo.listPrices(this.db, doctorId);
    const row = rows.find((r) => r.workTypeId === workTypeId);
    if (!row) throw notFound();
    return row;
  }
}
