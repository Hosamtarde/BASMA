import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { cases } from './cases';
import { aggregateColumns, amountColumn, idColumn, MAX_AMOUNT_MINOR } from './columns';
import { doctors } from './doctors';
import { users } from './identity';

const MAX = sql.raw(String(MAX_AMOUNT_MINOR));
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Images frozen into issued documents (B6, plan P5): the lab logo at issue, stored once per content hash.
 * `lab_logo` is a single row that is replaced, so an invoice keeps its own copy. Never updated or deleted
 * (trigger `document_images_guard`).
 */
export const documentImages = pgTable(
  'document_images',
  {
    sha256: text('sha256').primaryKey(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    content: bytea('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('document_images_mime_type_ck', sql`${t.mimeType} in ('image/png', 'image/jpeg')`),
    check('document_images_size_ck', sql`${t.sizeBytes} between 1 and 1048576`),
    check('document_images_sha256_ck', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Invoices (SPEC §5.14, §7.6, §7.7; B6 plan §2). Issued content is immutable: the trigger `invoices_guard`
 * lets only the void columns (and row_version / updated_*) change, once, from active to void, and refuses any
 * delete. `snapshot` holds everything printed; `snapshot_sha256` is SHA-256 over its canonical JSON, checked on
 * every read. Invoices never enter the ledger (plan §3).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: idColumn(),
    no: bigint('no', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    doctorId: bigint('doctor_id', { mode: 'number' }).references(() => doctors.id, { onDelete: 'restrict' }),
    /** The party name as printed (frozen): the doctor's name at issue, or the typed name of a free invoice. */
    partyName: text('party_name').notNull(),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    language: text('language').notNull(),
    currencyCode: text('currency_code').notNull(),
    /** NULL for statements (their figures live in the snapshot). */
    subtotal: amountColumn('subtotal'),
    discount: amountColumn('discount'),
    total: amountColumn('total'),
    status: text('status').notNull().default('active'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: bigint('voided_by', { mode: 'number' }).references(() => users.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').notNull(),
    snapshotVersion: smallint('snapshot_version').notNull(),
    snapshotSha256: text('snapshot_sha256').notNull(),
    logoSha256: text('logo_sha256').references(() => documentImages.sha256, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key'),
    requestHash: text('request_hash'),
    ...aggregateColumns(),
  },
  (t) => [
    uniqueIndex('invoices_no_uq').on(t.no),
    uniqueIndex('invoices_idempotency_key_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // Invoice list (newest first) and the doctor's documents.
    index('invoices_issue_date_ix').on(t.issueDate.desc(), t.id.desc()),
    index('invoices_doctor_ix').on(t.doctorId, t.issueDate.desc()),
    // Home «الفواتير» count and the list's status/type chips.
    index('invoices_status_type_ix').on(t.status, t.type),
    check('invoices_no_ck', sql`${t.no} > 0`),
    check('invoices_type_ck', sql`${t.type} in ('cases','statement','free')`),
    check('invoices_language_ck', sql`${t.language} in ('ar','en')`),
    check('invoices_status_ck', sql`${t.status} in ('active','void')`),
    check('invoices_party_name_ck', sql`char_length(${t.partyName}) between 1 and 100`),
    check('invoices_party_ck', sql`${t.type} = 'free' or ${t.doctorId} is not null`),
    check(
      'invoices_money_ck',
      sql`case when ${t.type} = 'statement'
            then ${t.subtotal} is null and ${t.discount} is null and ${t.total} is null
            else ${t.subtotal} is not null and ${t.discount} is not null and ${t.total} is not null
              and ${t.subtotal} between 0 and ${MAX} and ${t.discount} between 0 and ${t.subtotal}
              and ${t.total} = ${t.subtotal} - ${t.discount}
              and (${t.type} <> 'free' or (${t.total} > 0 and ${t.discount} = 0))
          end`,
    ),
    check(
      'invoices_void_ck',
      sql`(${t.status} = 'void') = (${t.voidedAt} is not null)
          and (${t.status} = 'void') = (${t.voidReason} is not null)
          and (${t.voidReason} is null or char_length(${t.voidReason}) between 1 and 300)`,
    ),
    check('invoices_idempotency_ck', sql`(${t.idempotencyKey} is null) = (${t.requestHash} is null)`),
    check('invoices_sha256_ck', sql`${t.snapshotSha256} ~ '^[0-9a-f]{64}$'`),
    check('invoices_row_version_ck', sql`${t.rowVersion} >= 1`),
  ],
);

/**
 * Cases on a cases invoice (plan P1). Rows are never deleted: a void sets `active = false`. The partial unique
 * index guarantees one ACTIVE invoice per case in the database itself (SPEC §5.14).
 */
export const invoiceCases = pgTable(
  'invoice_cases',
  {
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    caseId: bigint('case_id', { mode: 'number' })
      .notNull()
      .references(() => cases.id, { onDelete: 'restrict' }),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.caseId] }),
    uniqueIndex('invoice_cases_active_case_uq')
      .on(t.caseId)
      .where(sql`${t.active}`),
    // The case's history of invoices (case details, eligibility).
    index('invoice_cases_case_ix').on(t.caseId),
  ],
);
