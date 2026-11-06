/** Stored status codes (SPEC §9); labels come from the catalogs (`case.status.<code>`). */
export const CASE_STATUSES = [
  'waiting',
  'design',
  'in_progress',
  'ready',
  'delivered',
  'returned',
  'cancelled',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses before delivery: free movement among them, cancel allowed only from here. */
export const PRE_DELIVERY: readonly CaseStatus[] = ['waiting', 'design', 'in_progress', 'ready'];
export const DEFAULT_INITIAL_STATUS: CaseStatus = 'design';

export const AREAS = ['upper_arch', 'lower_arch', 'both_arches', 'none'] as const;
export type Area = (typeof AREAS)[number];

export const MAX_LINES_PER_CASE = 100;

export type TransitionCheck = 'ok' | 'same' | 'invalid';

/**
 * Owner-approved B2 machine:
 *   waiting ⇄ design ⇄ in_progress ⇄ ready (any order) → delivered
 *   delivered → returned → in_progress | ready | delivered
 *   cancelled only via cancel (see canCancel) and final.
 */
export function checkTransition(from: CaseStatus, to: CaseStatus): TransitionCheck {
  if (from === to) return 'same';
  if (to === 'cancelled' || from === 'cancelled') return 'invalid';
  if (PRE_DELIVERY.includes(from)) return PRE_DELIVERY.includes(to) || to === 'delivered' ? 'ok' : 'invalid';
  if (from === 'delivered') return to === 'returned' ? 'ok' : 'invalid';
  // from === 'returned'
  return to === 'in_progress' || to === 'ready' || to === 'delivered' ? 'ok' : 'invalid';
}

/** Cancel only before delivery; not from returned in B2 (to revisit with payments in B3). Final. */
export const canCancel = (status: CaseStatus): boolean => PRE_DELIVERY.includes(status);

/** FDI permanent teeth: quadrants 1–4, units 1–8. */
export function isFdiTooth(tooth: number): boolean {
  return Number.isInteger(tooth) && tooth >= 11 && tooth <= 48 && tooth % 10 >= 1 && tooth % 10 <= 8;
}

export type PriceSource = 'general' | 'special' | 'manual';

/** SPEC §7.5: manual override, else the doctor's special price, else the general price. */
export function resolvePrice(
  generalPrice: number,
  specialPrice: number | null | undefined,
  manualPrice?: number,
): { unitPrice: number; priceSource: PriceSource } {
  if (manualPrice !== undefined) return { unitPrice: manualPrice, priceSource: 'manual' };
  if (specialPrice !== null && specialPrice !== undefined) {
    return { unitPrice: specialPrice, priceSource: 'special' };
  }
  return { unitPrice: generalPrice, priceSource: 'general' };
}

export const subtotalOf = (lines: readonly { unitPrice: number }[]): number =>
  lines.reduce((sum, l) => sum + l.unitPrice, 0);

/** total = subtotal − discount; null when the discount would make it negative. */
export function totalOf(subtotal: number, discount: number): number | null {
  return discount > subtotal ? null : subtotal - discount;
}

/** Overdue: expected date passed (lab's today) and the case is still in the lab. */
export function isOverdue(c: { status: CaseStatus; expectedDate: string }, today: string): boolean {
  return c.expectedDate < today && c.status !== 'delivered' && c.status !== 'cancelled';
}
