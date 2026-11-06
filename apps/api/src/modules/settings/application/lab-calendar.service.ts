import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../../config/app-config';
import { APP_CONFIG } from '../../../config/config.module';
import { DB } from '../../../shared/db/database';
import type { Database, Tx } from '../../../shared/db/database';
import { CLOCK } from '../../../shared/time/clock';
import type { Clock } from '../../../shared/time/clock';
import { dateInTimeZone } from '../../../shared/time/lab-date';
import { LAB_PROFILE, LabProfile } from '../domain/settings-rules';
import { SettingsRepository } from '../infrastructure/settings.repository';

/**
 * The lab's "today", from the lab-profile time zone (fallback: DEFAULT_TIME_ZONE).
 * Every date rule (received not in the future, overdue, delivery date) goes through here,
 * so list filters and detail flags can never disagree (B2 addition D).
 */
@Injectable()
export class LabCalendar {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsRepository,
  ) {}

  async timeZone(db: Database | Tx = this.db): Promise<string> {
    const profile = await this.settings.get<LabProfile>(db, LAB_PROFILE);
    return profile?.value.timeZone ?? this.config.defaultTimeZone;
  }

  async today(db: Database | Tx = this.db): Promise<string> {
    return dateInTimeZone(this.clock.now(), await this.timeZone(db));
  }
}
