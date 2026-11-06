import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditParams, AuditWriter } from '../../../shared/audit/audit-writer';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { notFound, staleVersion } from '../../../shared/errors/common-errors';
import { DomainError } from '../../../shared/errors/domain-error';
import {
  COUNTER_NAMES,
  Counter,
  CounterName,
  CURRENCY,
  CurrencySetting,
  hasLabName,
  isCounterLocked,
  LAB_PROFILE,
  LabProfile,
  LANGUAGE,
  LanguageSetting,
  lockedCurrencyFields,
  withNewStart,
} from '../domain/settings-rules';
import { LogoMeta, LogoRepository } from '../infrastructure/logo.repository';
import { SettingsRepository } from '../infrastructure/settings.repository';

type Versioned<T> = T & { rowVersion: number };

export interface SettingsView {
  labProfile: Versioned<LabProfile> | null;
  currency: (Versioned<CurrencySetting> & { locked: { code: boolean; decimals: boolean } }) | null;
  language: Versioned<LanguageSetting> | null;
  numbering: Record<CounterName, Counter & { locked: boolean }>;
  logo: LogoMeta | null;
}

export interface InitialSettings {
  labProfile: LabProfile;
  currency: CurrencySetting;
  language: LanguageSetting;
}

type Primitive = string | number | boolean | null;

/** Keeps only fields that were sent and differ from the stored value. */
function diff<T extends object>(current: T, patch: Partial<T>): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] !== undefined && patch[key] !== current[key]) changes[key] = patch[key];
  }
  return changes;
}

/** Settings values are flat primitives, so old/new values go straight into the audit params. */
function auditParams<T extends object>(current: T, changes: Partial<T>): AuditParams {
  const before = current as Record<string, Primitive | undefined>;
  const after = changes as Record<string, Primitive | undefined>;
  const params: AuditParams = { fields: Object.keys(changes).join(',') };
  for (const key of Object.keys(changes)) {
    params[`${key}Old`] = before[key] ?? null;
    params[`${key}New`] = after[key] ?? null;
  }
  return params;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly repo: SettingsRepository,
    private readonly audit: AuditWriter,
    private readonly logos: LogoRepository,
  ) {}

  async view(): Promise<SettingsView> {
    const [labProfile, currency, language, counters, hasMoney, logo] = await Promise.all([
      this.repo.get<LabProfile>(this.db, LAB_PROFILE),
      this.repo.get<CurrencySetting>(this.db, CURRENCY),
      this.repo.get<LanguageSetting>(this.db, LANGUAGE),
      this.repo.counters(this.db),
      this.repo.hasMoneyData(this.db),
      this.logos.meta(this.db),
    ]);
    const numbering = Object.fromEntries(
      COUNTER_NAMES.map((name) => {
        const c = counters[name] ?? { startValue: 1, nextValue: 1 };
        return [name, { ...c, locked: isCounterLocked(c) }];
      }),
    ) as SettingsView['numbering'];
    return {
      labProfile: labProfile ? { ...labProfile.value, rowVersion: labProfile.rowVersion } : null,
      currency: currency
        ? {
            ...currency.value,
            rowVersion: currency.rowVersion,
            locked: { code: hasMoney, decimals: hasMoney },
          }
        : null,
      language: language ? { ...language.value, rowVersion: language.rowVersion } : null,
      numbering,
      logo: logo ?? null,
    };
  }

  /** Called by first-run setup inside its transaction. */
  async initialize(tx: Tx, initial: InitialSettings, userId: number): Promise<void> {
    await this.repo.insert(tx, LAB_PROFILE, initial.labProfile, userId);
    await this.repo.insert(tx, CURRENCY, initial.currency, userId);
    await this.repo.insert(tx, LANGUAGE, initial.language, userId);
  }

  async updateLabProfile(
    rowVersion: number,
    patch: Partial<LabProfile>,
    userId: number,
  ): Promise<SettingsView> {
    await this.updateGroup<LabProfile>(LAB_PROFILE, rowVersion, patch, userId, (merged) => {
      if (!hasLabName(merged)) {
        throw new DomainError('error.settings.lab_name_required', HttpStatus.BAD_REQUEST);
      }
    });
    return this.view();
  }

  /** Code and decimals lock once money exists; the symbol always stays editable (owner, B1). */
  async updateCurrency(
    rowVersion: number,
    patch: Partial<CurrencySetting>,
    userId: number,
  ): Promise<SettingsView> {
    await this.updateGroup<CurrencySetting>(
      CURRENCY,
      rowVersion,
      patch,
      userId,
      async (_merged, current, tx) => {
        // We hold the UPDATE lock on the currency row; money writers wait on their SHARE lock.
        const locked = lockedCurrencyFields(current, patch, await this.repo.hasMoneyData(tx));
        if (locked.length > 0) {
          throw new DomainError('error.settings.currency_locked', HttpStatus.CONFLICT, {
            fields: locked.join(','),
          });
        }
      },
    );
    return this.view();
  }

  async updateLanguage(
    rowVersion: number,
    patch: Partial<LanguageSetting>,
    userId: number,
  ): Promise<SettingsView> {
    await this.updateGroup<LanguageSetting>(LANGUAGE, rowVersion, patch, userId);
    return this.view();
  }

  /**
   * Addition C: a start value changes only while nothing was issued, and next_value moves with it,
   * in the same transaction (row-locked). All requested counters change, or none.
   */
  async updateNumbering(starts: Partial<Record<CounterName, number>>, userId: number): Promise<SettingsView> {
    await this.db.transaction(async (tx) => {
      for (const name of COUNTER_NAMES) {
        const start = starts[name];
        if (start === undefined) continue;
        const current = await this.repo.counterForUpdate(tx, name);
        if (!current) throw notFound();
        if (current.startValue === start && !isCounterLocked(current)) continue;
        const next = withNewStart(current, start);
        if (!next) {
          throw new DomainError('error.settings.numbering_locked', HttpStatus.CONFLICT, { counter: name });
        }
        await this.repo.setCounter(tx, name, next);
        await this.audit.write(tx, {
          userId,
          action: 'settings.numbering_updated',
          entity: 'settings',
          entityId: name,
          params: { counter: name, startOld: current.startValue, startNew: start },
        });
      }
    });
    return this.view();
  }

  private async updateGroup<T extends object>(
    key: string,
    rowVersion: number,
    patch: Partial<T>,
    userId: number,
    validate?: (merged: T, current: T, tx: Tx) => void | Promise<void>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const stored = await this.repo.get<T>(tx, key, true);
      if (!stored) throw notFound();
      if (stored.rowVersion !== rowVersion) throw staleVersion();
      const changes = diff(stored.value, patch);
      if (Object.keys(changes).length === 0) return;
      const merged = { ...stored.value, ...changes };
      await validate?.(merged, stored.value, tx);
      await this.repo.update(tx, key, merged, userId);
      await this.audit.write(tx, {
        userId,
        action: `settings.${key}_updated`,
        entity: 'settings',
        entityId: key,
        params: auditParams(stored.value, changes),
      });
    });
  }
}
