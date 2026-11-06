import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { aggregateColumns, amountColumn, idColumn, MAX_AMOUNT_MINOR } from './columns';

export const technicians = pgTable(
  'technicians',
  {
    id: idColumn(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('technicians_name_lower_uq').on(sql`lower(${t.name})`),
    check('technicians_name_length_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('technicians_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

export const workTypes = pgTable(
  'work_types',
  {
    id: idColumn(),
    name: text('name').notNull(),
    /** General price per tooth, minor units. */
    unitPrice: amountColumn('unit_price').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('work_types_name_lower_uq').on(sql`lower(${t.name})`),
    check('work_types_name_length_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('work_types_unit_price_ck', sql`${t.unitPrice} between 0 and ${sql.raw(String(MAX_AMOUNT_MINOR))}`),
    check('work_types_sort_order_ck', sql`${t.sortOrder} between 0 and 10000`),
    check('work_types_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: idColumn(),
    name: text('name').notNull(),
    /** The system «doctor refund» category; set only by first-run setup, never via the API. */
    isDoctor: boolean('is_doctor').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('expense_categories_name_lower_uq').on(sql`lower(${t.name})`),
    // At most one doctor-refund category.
    uniqueIndex('expense_categories_single_doctor_uq')
      .on(t.isDoctor)
      .where(sql`${t.isDoctor}`),
    check('expense_categories_name_length_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('expense_categories_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);
