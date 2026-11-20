import { createHash } from 'node:crypto';
import { canonicalJson } from '../../payments/domain/payment-rules';

/** Statuses a case must have to be invoiced: «حالات منجزة» (SPEC §5.14, I5). */
export const INVOICEABLE_STATUSES: readonly string[] = ['delivered', 'ready'];

export const isInvoiceable = (status: string): boolean => INVOICEABLE_STATUSES.includes(status);

/** settings key of the invoice appearance (SPEC §5.15). */
export const INVOICE_TEMPLATE = 'invoice_template';

/**
 * SHA-256 over the canonical JSON of a snapshot (object keys sorted, no whitespace). PostgreSQL `jsonb`
 * normalises key order and spacing, so hashing the canonical form gives the same digest before the insert and
 * after any read, dump or restore (plan P4).
 */
export const snapshotSha256 = (snapshot: unknown): string =>
  createHash('sha256').update(canonicalJson(snapshot)).digest('hex');

export const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

export type FieldRule = 'required' | 'optional' | 'forbidden';

/** Which request fields each invoice type takes (plan §7.1). Anything else is refused by name. */
export const FIELDS_BY_TYPE: Record<'cases' | 'statement' | 'free', Record<string, FieldRule>> = {
  cases: {
    doctorId: 'required',
    caseIds: 'required',
    expectedTotal: 'required',
    notes: 'optional',
    language: 'optional',
    from: 'forbidden',
    to: 'forbidden',
    partyName: 'forbidden',
    reason: 'forbidden',
    amount: 'forbidden',
  },
  statement: {
    doctorId: 'required',
    from: 'optional',
    to: 'optional',
    notes: 'optional',
    language: 'optional',
    caseIds: 'forbidden',
    expectedTotal: 'forbidden',
    partyName: 'forbidden',
    reason: 'forbidden',
    amount: 'forbidden',
  },
  free: {
    reason: 'required',
    amount: 'required',
    doctorId: 'optional',
    partyName: 'optional',
    notes: 'optional',
    language: 'optional',
    caseIds: 'forbidden',
    expectedTotal: 'forbidden',
    from: 'forbidden',
    to: 'forbidden',
  },
};

/** The first field that breaks the type's rules, or null. */
export function fieldProblem(
  type: 'cases' | 'statement' | 'free',
  input: Record<string, unknown>,
): { field: string; rule: 'required' | 'forbidden' } | null {
  for (const [field, rule] of Object.entries(FIELDS_BY_TYPE[type])) {
    const present = input[field] !== undefined && input[field] !== null;
    if (rule === 'required' && !present) return { field, rule };
    if (rule === 'forbidden' && present) return { field, rule };
  }
  return null;
}
