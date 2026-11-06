import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { technicians, workTypes } from './catalog';
import { aggregateColumns, amountColumn, idColumn, MAX_AMOUNT_MINOR } from './columns';
import { doctors } from './doctors';
import { users } from './identity';

const MAX = sql.raw(String(MAX_AMOUNT_MINOR));

/** Stored codes (SPEC §6.1); labels come from the catalogs. */
const STATUSES = sql.raw(`'waiting','design','in_progress','ready','delivered','returned','cancelled'`);

export const cases = pgTable(
  'cases',
  {
    id: idColumn(),
    caseNo: bigint('case_no', { mode: 'number' }).notNull(),
    doctorId: bigint('doctor_id', { mode: 'number' })
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    patientName: text('patient_name').notNull(),
    technicianId: bigint('technician_id', { mode: 'number' }).references(() => technicians.id, {
      onDelete: 'restrict',
    }),
    receivedDate: date('received_date', { mode: 'string' }).notNull(),
    expectedDate: date('expected_date', { mode: 'string' }).notNull(),
    /** Set only while status = delivered; earlier delivery dates live in case_status_history. */
    deliveredDate: date('delivered_date', { mode: 'string' }),
    status: text('status').notNull(),
    discount: amountColumn('discount').notNull().default(0),
    /** Cached Σ case_items.unit_price − discount, recomputed in every write transaction (SPEC §7.3). */
    total: amountColumn('total').notNull().default(0),
    notes: text('notes'),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('cases_case_no_uq').on(t.caseNo),
    // Doctor account / statement lists (B3/B4) and filters.
    index('cases_doctor_received_ix').on(t.doctorId, t.receivedDate),
    // Status filter and overdue list (expected_date < today).
    index('cases_status_expected_ix').on(t.status, t.expectedDate),
    check('cases_case_no_ck', sql`${t.caseNo} > 0`),
    check('cases_status_ck', sql`${t.status} in (${STATUSES})`),
    check('cases_patient_name_length_ck', sql`char_length(${t.patientName}) between 1 and 100`),
    check('cases_notes_length_ck', sql`char_length(${t.notes}) <= 2000`),
    check('cases_expected_after_received_ck', sql`${t.expectedDate} >= ${t.receivedDate}`),
    // Addition A: delivered_date exists exactly while delivered, never before received.
    check(
      'cases_delivered_date_ck',
      sql`(${t.status} = 'delivered') = (${t.deliveredDate} is not null)
          and (${t.deliveredDate} is null or ${t.deliveredDate} >= ${t.receivedDate})`,
    ),
    check('cases_discount_ck', sql`${t.discount} between 0 and ${MAX}`),
    check('cases_total_ck', sql`${t.total} between 0 and ${MAX}`),
    check('cases_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

/** One line per tooth (FDI) or per area — never both, never neither (owner decision B2). */
export const caseItems = pgTable(
  'case_items',
  {
    id: idColumn(),
    caseId: bigint('case_id', { mode: 'number' })
      .notNull()
      .references(() => cases.id, { onDelete: 'restrict' }),
    toothNo: smallint('tooth_no'),
    area: text('area'),
    workTypeId: bigint('work_type_id', { mode: 'number' })
      .notNull()
      .references(() => workTypes.id, { onDelete: 'restrict' }),
    /** Snapshot: later renames never change existing lines. */
    workTypeName: text('work_type_name').notNull(),
    shade: text('shade'),
    /** Snapshot price resolved at line creation (SPEC §7.5) or set by hand. */
    unitPrice: amountColumn('unit_price').notNull(),
    priceSource: text('price_source').notNull(),
    note: text('note'),
  },
  (t) => [
    index('case_items_case_ix').on(t.caseId),
    check('case_items_position_ck', sql`(${t.toothNo} is null) <> (${t.area} is null)`),
    check(
      'case_items_tooth_ck',
      sql`${t.toothNo} is null or (${t.toothNo} between 11 and 48 and ${t.toothNo} % 10 between 1 and 8)`,
    ),
    check(
      'case_items_area_ck',
      sql`${t.area} is null or ${t.area} in ('upper_arch','lower_arch','both_arches','none')`,
    ),
    check('case_items_price_source_ck', sql`${t.priceSource} in ('general','special','manual')`),
    check('case_items_unit_price_ck', sql`${t.unitPrice} between 0 and ${MAX}`),
    check('case_items_shade_length_ck', sql`char_length(${t.shade}) between 1 and 20`),
    check('case_items_note_length_ck', sql`char_length(${t.note}) <= 200`),
    check('case_items_work_type_name_length_ck', sql`char_length(${t.workTypeName}) between 1 and 100`),
  ],
);

export const caseStatusHistory = pgTable(
  'case_status_history',
  {
    id: idColumn(),
    caseId: bigint('case_id', { mode: 'number' })
      .notNull()
      .references(() => cases.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    /** Kept for every delivery, so re-deliveries never lose the earlier date (addition A). */
    deliveredDate: date('delivered_date', { mode: 'string' }),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('case_status_history_case_ix').on(t.caseId, t.at),
    check('case_status_history_from_ck', sql`${t.fromStatus} is null or ${t.fromStatus} in (${STATUSES})`),
    check('case_status_history_to_ck', sql`${t.toStatus} in (${STATUSES})`),
    check('case_status_history_note_length_ck', sql`char_length(${t.note}) <= 500`),
  ],
);
