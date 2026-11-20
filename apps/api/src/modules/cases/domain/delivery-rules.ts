/**
 * Delivery of a case (SPEC §5.7, §9; B5 plan §4, owner decisions N1–N4). Pure rules: the service
 * computes the inputs under its locks and applies the verdict in one transaction.
 */

export const DELIVERY_RECEIVED = ['full', 'partial', 'none'] as const;
export type DeliveryReceived = (typeof DELIVERY_RECEIVED)[number];

/**
 * What the lab may still ask for when it hands the case over (N1): what is unpaid on the case
 * (`remaining`, the FIFO figure) minus the doctor's cheques for this case that have not cleared yet,
 * never below 0 and never above what a bound payment may still take (`room`, the D5 limit). The
 * last bound is already implied by the first (remaining ≤ total − bound counted), kept for safety.
 */
export function deliveryDue(remaining: number, pendingBoundCheques: number, room: number): number {
  return Math.max(0, Math.min(remaining - pendingBoundCheques, room));
}

export interface DeliveryRequest {
  received?: DeliveryReceived;
  amount?: number;
  method?: string;
  collectOn?: string;
}

export type DeliveryVerdict =
  | { ok: true; paymentAmount: number; collectOn: string | null }
  | { ok: false; code: string; status: 400 | 409; params?: Record<string, number> };

/**
 * Decides what a delivery request means once the amount due is known (N1–N4):
 * - nothing due: no question; only `full` (or nothing) is accepted, no amount, no collect date;
 * - `full`: a payment for exactly `due` (the client sends no amount), no collect date;
 * - `partial`: an amount with 0 < amount < due (equal: choose `full`; above: 409), and a collect date;
 * - `none`: no payment, a collect date.
 * The collect date is on or after the delivery date (N2).
 */
export function decideDelivery(req: DeliveryRequest, due: number, deliveredDate: string): DeliveryVerdict {
  const bad = (code: string, params?: Record<string, number>): DeliveryVerdict => ({
    ok: false,
    code,
    status: 400,
    ...(params ? { params } : {}),
  });
  if (due === 0) {
    if (req.received === 'partial' || req.received === 'none') {
      return { ok: false, code: 'error.delivery.nothing_due', status: 409 };
    }
    if (req.amount !== undefined || req.method !== undefined) return bad('error.delivery.amount_not_allowed');
    if (req.collectOn !== undefined) return bad('error.delivery.collect_on_not_allowed');
    return { ok: true, paymentAmount: 0, collectOn: null };
  }
  if (req.received === undefined) return bad('error.delivery.received_required');
  if (req.received === 'none') {
    if (req.amount !== undefined || req.method !== undefined) return bad('error.delivery.amount_not_allowed');
  } else if (req.method === undefined) {
    return bad('error.delivery.method_required');
  }
  if (req.received === 'full') {
    if (req.amount !== undefined) return bad('error.delivery.amount_not_allowed');
    if (req.collectOn !== undefined) return bad('error.delivery.collect_on_not_allowed');
    return { ok: true, paymentAmount: due, collectOn: null };
  }
  if (req.received === 'partial') {
    if (req.amount === undefined) return bad('error.delivery.amount_required');
    if (req.amount > due) {
      return { ok: false, code: 'error.delivery.exceeds_remaining', status: 409, params: { max: due } };
    }
    // The whole amount is "full" (no collect date then); say so instead of guessing.
    if (req.amount === due) return bad('error.delivery.partial_equals_due');
  }
  if (req.collectOn === undefined) return bad('error.delivery.collect_on_required');
  if (!collectOnValid(req.collectOn, deliveredDate)) return bad('error.delivery.collect_on_invalid');
  return { ok: true, paymentAmount: req.received === 'partial' ? (req.amount ?? 0) : 0, collectOn: req.collectOn };
}

/** A collect date is never before the delivery date (N2; also the database CHECK). */
export const collectOnValid = (collectOn: string, deliveredDate: string): boolean => collectOn >= deliveredDate;
