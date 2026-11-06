import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../../config/app-config';
import { APP_CONFIG } from '../../../config/config.module';
import { AuditWriter } from '../../../shared/audit/audit-writer';
import { DB } from '../../../shared/db/database';
import type { Database } from '../../../shared/db/database';
import { DomainError } from '../../../shared/errors/domain-error';
import type { Language } from '../../../shared/i18n/i18n.service';
import { ExpenseCategoriesService } from '../../catalog/application/expense-categories.service';
import { SettingsService } from '../../settings/application/settings.service';
import { CurrencySetting, hasLabName } from '../../settings/domain/settings-rules';
import { OWNER_ROLE } from '../domain/permissions';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { PasswordHasher } from './password-hasher';

export interface FirstRunInput {
  username: string;
  password: string;
  lab: { nameAr?: string | null; nameEn?: string | null; phone: string; address?: string | null };
  currency: CurrencySetting;
  language: Language;
  timeZone?: string;
}

@Injectable()
export class SetupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repo: IdentityRepository,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditWriter,
    private readonly settings: SettingsService,
    private readonly expenseCategories: ExpenseCategoriesService,
  ) {}

  async isSetupRequired(): Promise<boolean> {
    return !(await this.repo.anyUserExists(this.db));
  }

  /**
   * First run, in ONE transaction (all or nothing): owner account, lab profile, currency,
   * language, time zone, and the expense categories named in the setup language.
   * Work types start empty — the owner enters their own types and prices (owner decision B1).
   * Locks itself: works only while no user exists (advisory lock + check in the transaction).
   */
  async run(input: FirstRunInput): Promise<{ id: number; username: string }> {
    const labProfile = {
      nameAr: input.lab.nameAr ?? null,
      nameEn: input.lab.nameEn ?? null,
      phone: input.lab.phone,
      address: input.lab.address ?? null,
      timeZone: input.timeZone ?? this.config.defaultTimeZone,
    };
    if (!hasLabName(labProfile)) {
      throw new DomainError('error.settings.lab_name_required', HttpStatus.BAD_REQUEST);
    }
    const passwordHash = await this.hasher.hash(input.password);

    return this.db.transaction(async (tx) => {
      await this.repo.lockSetup(tx);
      if (await this.repo.anyUserExists(tx)) {
        throw new DomainError('error.setup.already_done', HttpStatus.CONFLICT);
      }
      const id = await this.repo.insertUser(tx, input.username, passwordHash);
      await this.repo.assignRole(tx, id, OWNER_ROLE);
      await this.settings.initialize(
        tx,
        {
          labProfile,
          currency: input.currency,
          language: { ui: input.language, documents: input.language },
        },
        id,
      );
      await this.expenseCategories.seedDefaults(tx, input.language, id);
      await this.audit.write(tx, {
        userId: id,
        action: 'setup.completed',
        entity: 'user',
        entityId: id,
        params: { username: input.username },
      });
      return { id, username: input.username };
    });
  }
}
