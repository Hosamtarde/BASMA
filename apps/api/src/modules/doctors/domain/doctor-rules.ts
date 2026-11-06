/**
 * Owner rule (B1, addition A): a non-zero opening balance is financial data, so such a doctor
 * is never hard-deleted — only deactivated. Doctors with cases or payments are protected by
 * foreign keys (SPEC §5.2) through the shared delete-or-deactivate helper.
 */
export function mayHardDelete(doctor: { openingBalance: number }): boolean {
  return doctor.openingBalance === 0;
}

/** Digits of any script (Arabic-Indic too), spaces, +, -, parentheses. */
export const PHONE_PATTERN = /^[\p{Nd}+\-() ]+$/u;
export const PHONE_MAX_LENGTH = 30;
export const CLINIC_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 1000;
