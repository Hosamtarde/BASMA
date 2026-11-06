/**
 * First-run expense categories (owner decision B1), named in the setup language via the
 * catalog keys `seed.expense_category.<code>`. The owner may rename or remove them later,
 * except the doctor-refund category, which the ledger needs (SPEC §5.9, §7.3).
 */
export const DOCTOR_REFUND_CATEGORY = 'doctor_refund';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'rent',
  'electricity',
  'water',
  'materials',
  'salaries',
  'transport',
  'other',
] as const;

export const seedNameKey = (code: string): string => `seed.expense_category.${code}`;
