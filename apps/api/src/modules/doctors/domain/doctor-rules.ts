/**
 * Owner rule (B1, addition A): a non-zero opening balance is financial data, so such a doctor
 * is never hard-deleted — only deactivated. Doctors with cases or payments are protected by
 * foreign keys (SPEC §5.2) through the shared delete-or-deactivate helper.
 */
export function mayHardDelete(doctor: { openingBalance: number }): boolean {
  return doctor.openingBalance === 0;
}

export { PHONE_MAX_LENGTH, PHONE_PATTERN } from '../../../shared/http/text-fields';
export const CLINIC_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 1000;
