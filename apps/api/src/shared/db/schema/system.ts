import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './identity';

/** Install identity: `db_marker` (random per install) and `product` — checked before a restore (ADR-0012). */
export const schemaMeta = pgTable('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    rowVersion: integer('row_version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [check('settings_row_version_ck', sql`${t.rowVersion} >= 1`)],
);

/** Gap-free business numbers; rows are added by the milestone that needs them (B2+). */
export const counters = pgTable(
  'counters',
  {
    name: text('name').primaryKey(),
    nextValue: bigint('next_value', { mode: 'number' }).notNull(),
  },
  (t) => [check('counters_next_value_ck', sql`${t.nextValue} > 0`)],
);

/** Stores action code + params only; the human text is rendered per language on read (SPEC §6.1). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    params: jsonb('params').notNull().default({}),
  },
  // «آخر العمليات» lists the latest entries.
  (t) => [index('audit_log_at_ix').on(t.at.desc())],
);
