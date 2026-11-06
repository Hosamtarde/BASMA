import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workTypes } from './catalog';
import { aggregateColumns, amountColumn, idColumn, MAX_AMOUNT_MINOR } from './columns';
import { users } from './identity';

const MAX = sql.raw(String(MAX_AMOUNT_MINOR));

export const doctors = pgTable(
  'doctors',
  {
    id: idColumn(),
    name: text('name').notNull(),
    phone: text('phone'),
    clinic: text('clinic'),
    notes: text('notes'),
    /** Signed, minor units: > 0 the doctor owed the lab before the system started. */
    openingBalance: amountColumn('opening_balance').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('doctors_name_lower_uq').on(sql`lower(${t.name})`),
    check('doctors_name_length_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('doctors_phone_length_ck', sql`char_length(${t.phone}) <= 30`),
    check('doctors_clinic_length_ck', sql`char_length(${t.clinic}) <= 100`),
    check('doctors_notes_length_ck', sql`char_length(${t.notes}) <= 1000`),
    check('doctors_opening_balance_ck', sql`${t.openingBalance} between -${MAX} and ${MAX}`),
    check('doctors_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

/** Special price of a work type for one doctor (SPEC §5.12, §7.5). Configuration, not history. */
export const doctorPrices = pgTable(
  'doctor_prices',
  {
    doctorId: bigint('doctor_id', { mode: 'number' })
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    workTypeId: bigint('work_type_id', { mode: 'number' })
      .notNull()
      .references(() => workTypes.id, { onDelete: 'restrict' }),
    price: amountColumn('price').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ name: 'doctor_prices_pk', columns: [t.doctorId, t.workTypeId] }),
    check('doctor_prices_price_ck', sql`${t.price} between 0 and ${MAX}`),
  ],
);
