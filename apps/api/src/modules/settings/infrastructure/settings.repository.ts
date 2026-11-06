import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../../shared/db/database';
import { counters, settings } from '../../../shared/db/schema';
import type { Counter, CounterName } from '../domain/settings-rules';

type Executor = Database | Tx;

export interface StoredSetting<T> {
  value: T;
  rowVersion: number;
}

@Injectable()
export class SettingsRepository {
  async get<T>(db: Executor, key: string, forUpdate = false): Promise<StoredSetting<T> | undefined> {
    const query = db
      .select({ value: settings.value, rowVersion: settings.rowVersion })
      .from(settings)
      .where(eq(settings.key, key));
    const [row] = forUpdate ? await query.for('update') : await query;
    return row ? { value: row.value as T, rowVersion: row.rowVersion } : undefined;
  }

  async insert(tx: Tx, key: string, value: unknown, userId: number): Promise<void> {
    await tx.insert(settings).values({ key, value, updatedBy: userId });
  }

  async update(tx: Tx, key: string, value: unknown, userId: number): Promise<void> {
    await tx
      .update(settings)
      .set({ value, rowVersion: sql`${settings.rowVersion} + 1`, updatedAt: new Date(), updatedBy: userId })
      .where(eq(settings.key, key));
  }

  async counters(db: Executor): Promise<Record<string, Counter>> {
    const rows = await db
      .select({ name: counters.name, startValue: counters.startValue, nextValue: counters.nextValue })
      .from(counters);
    return Object.fromEntries(
      rows.map((r) => [r.name, { startValue: r.startValue, nextValue: r.nextValue }]),
    );
  }

  async counterForUpdate(tx: Tx, name: CounterName): Promise<Counter | undefined> {
    const [row] = await tx
      .select({ startValue: counters.startValue, nextValue: counters.nextValue })
      .from(counters)
      .where(eq(counters.name, name))
      .for('update');
    return row;
  }

  async setCounter(tx: Tx, name: CounterName, counter: Counter): Promise<void> {
    await tx
      .update(counters)
      .set({ startValue: counter.startValue, nextValue: counter.nextValue })
      .where(eq(counters.name, name));
  }

  /**
   * True once any money amount is stored (locks currency code/decimals).
   * Any case counts (B2). Later milestones add their tables here: payments (B3), invoices (B6).
   */
  async hasMoneyData(db: Executor): Promise<boolean> {
    const result = await db.execute<{ present: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM work_types WHERE unit_price <> 0)
          OR EXISTS (SELECT 1 FROM doctors WHERE opening_balance <> 0)
          OR EXISTS (SELECT 1 FROM doctor_prices)
          OR EXISTS (SELECT 1 FROM cases) AS present`);
    return result.rows[0]?.present === true;
  }
}
