import { bigint, integer, timestamp } from 'drizzle-orm/pg-core';
import { MAX_AMOUNT_MINOR } from '../../money/limits';
import { users } from './identity';

export { MAX_AMOUNT_MINOR };

/** Money in integer minor units (SPEC §7.1). */
export const amountColumn = (name: string) => bigint(name, { mode: 'number' });

export const idColumn = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();

/** Shared audit + optimistic-concurrency columns of mutable aggregates. */
export const aggregateColumns = () => ({
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
});
