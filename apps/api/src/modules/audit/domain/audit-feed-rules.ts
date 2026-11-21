/** Rows shown by «آخر العمليات» (SPEC §5.1): a small fixed page, never a parameter. */
export const AUDIT_FEED_SIZE = 20;

export interface AuditEntity {
  /** The audit row's entity type (`case`, `payment`, `doctor`, …); empty when the action names none. */
  entityType: string;
  /** What to show next to the action: a case or voucher number, a cheque number or a name. */
  entityLabel: string | null;
}

type Params = Record<string, unknown>;

/** Which stored parameter names the entity of an action (whitelist: nothing else is ever read). */
const LABEL_KEY: Record<string, string> = {
  case: 'caseNo',
  payment: 'voucherNo',
  outgoing: 'voucherNo',
  cheque: 'chequeNo',
  doctor: 'name',
  work_type: 'name',
  technician: 'name',
  expense_category: 'name',
  invoice: 'invoiceNo',
};

const MAX_LABEL = 100;

/**
 * The display-safe entity of an audit entry: its type and one label taken from a whitelisted
 * parameter. Reasons, notes, amounts, banks, filters and everything else stay on the server.
 */
export function auditEntity(action: string, entity: string | null, params: Params): AuditEntity {
  const prefix = action.split('.')[0] ?? '';
  const key = LABEL_KEY[prefix];
  const raw = key === undefined ? undefined : params[key];
  const label = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  return { entityType: entity ?? '', entityLabel: label === '' ? null : label.slice(0, MAX_LABEL) };
}
