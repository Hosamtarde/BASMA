import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
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

/**
 * Gap-free business numbers. `start_value` is the owner's chosen first number; it may change
 * only while nothing was issued (next_value = start_value), and then moves next_value with it.
 */
export const counters = pgTable(
  'counters',
  {
    name: text('name').primaryKey(),
    startValue: bigint('start_value', { mode: 'number' }).notNull(),
    nextValue: bigint('next_value', { mode: 'number' }).notNull(),
  },
  (t) => [
    check('counters_next_value_ck', sql`${t.nextValue} > 0`),
    check('counters_start_value_ck', sql`${t.startValue} > 0 and ${t.nextValue} >= ${t.startValue}`),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** The lab logo lives in the database so every backup contains it. Single row (id = 1). */
export const labLogo = pgTable(
  'lab_logo',
  {
    id: smallint('id').primaryKey().default(1),
    content: bytea('content').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check('lab_logo_single_row_ck', sql`${t.id} = 1`),
    check('lab_logo_mime_type_ck', sql`${t.mimeType} in ('image/png', 'image/jpeg')`),
    check('lab_logo_size_ck', sql`${t.sizeBytes} between 1 and 1048576`),
  ],
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
