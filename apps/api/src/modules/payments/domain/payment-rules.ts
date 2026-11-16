import { createHash } from 'node:crypto';

/** Stored codes (SPEC §6.1); labels come from the catalogs (`payment.method.<code>`). */
export const PAYMENT_METHODS = ['cash', 'cheque', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['active', 'void'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const CHEQUE_STATUSES = ['pending', 'cleared', 'returned'] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/** A cheque due within this many days (and still pending) is "soon" (SPEC §5.13). */
export const CHEQUE_DUE_SOON_DAYS = 7;

/**
 * SPEC §7.4: cash and transfers count at once, a cheque only while cleared; void never counts.
 * The SQL twin is `COUNTED_SQL` in the repository; a generated-matrix test keeps them equal.
 */
export function isCounted(p: {
  status: PaymentStatus;
  method: PaymentMethod;
  chequeStatus: ChequeStatus | null;
}): boolean {
  if (p.status !== 'active') return false;
  return p.method === 'cheque' ? p.chequeStatus === 'cleared' : true;
}

/**
 * Owner decision D3: pending → cleared | returned, cleared → returned; returned is final;
 * no revert (a mistaken click is fixed by voiding the payment and entering it again).
 */
const TRANSITIONS: Record<ChequeStatus, readonly ChequeStatus[]> = {
  pending: ['cleared', 'returned'],
  cleared: ['returned'],
  returned: [],
};

export const canChequeMove = (from: ChequeStatus, to: ChequeStatus): boolean =>
  TRANSITIONS[from].includes(to);

/** What the UI may offer for a cheque now; empty when its payment is void. */
export const allowedChequeStatuses = (status: ChequeStatus, paymentVoid: boolean): ChequeStatus[] =>
  paymentVoid ? [] : [...TRANSITIONS[status]];

export type DueState = 'none' | 'soon' | 'overdue';

/** Only a pending cheque of an active payment can be due or overdue. */
export function dueState(
  c: { status: ChequeStatus; dueDate: string; paymentVoid: boolean },
  today: string,
  soonUntil: string,
): DueState {
  if (c.status !== 'pending' || c.paymentVoid) return 'none';
  if (c.dueDate < today) return 'overdue';
  return c.dueDate <= soonUntil ? 'soon' : 'none';
}

/** IN-000001 (SPEC §7.7). */
export const formatVoucher = (no: number): string => `IN-${String(no).padStart(6, '0')}`;

/** Amount a payment bound to a case may still take: total minus what is already bound (D5). */
export const boundRoom = (caseTotal: number, alreadyBound: number): number =>
  Math.max(0, caseTotal - alreadyBound);

// ---------------------------------------------------------------- balance and allocation

export interface LedgerCase {
  id: number;
  caseNo: number;
  receivedDate: string;
  total: number;
  cancelled: boolean;
}

/** Counted payments only; `caseId` is the binding, if any. */
export interface CountedPayment {
  amount: number;
  caseId: number | null;
}

export interface CaseShare {
  paid: number;
  remaining: number;
}

export interface Allocation {
  cases: Map<number, CaseShare>;
  /** Part of a positive opening balance still unpaid (D4: the opening balance is the oldest item). */
  openingRemaining: number;
  /** Money in the pool nobody owes yet (overpayment, or a negative opening balance). */
  credit: number;
}

/** balance = opening + Σ non-cancelled case totals − Σ counted payments (SPEC §7.3). */
export function doctorBalance(opening: number, cases: readonly LedgerCase[], counted: number): number {
  return opening + cases.filter((c) => !c.cancelled).reduce((s, c) => s + c.total, 0) - counted;
}

/**
 * SPEC §7.3 `allocate`, pure. Items oldest first: a positive opening balance, then the non-cancelled
 * cases by received date then case number. A payment bound to a live case pays it first (capped at
 * its total); the excess and every payment bound to a cancelled case join the pool, which pays the
 * items still owing, oldest first. What is left is credit.
 * Invariant: Σ remaining + openingRemaining − credit = doctorBalance.
 */
export function allocate(
  opening: number,
  cases: readonly LedgerCase[],
  payments: readonly CountedPayment[],
): Allocation {
  const live = cases
    .filter((c) => !c.cancelled)
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.caseNo - b.caseNo);
  const liveIds = new Set(live.map((c) => c.id));

  const bound = new Map<number, number>();
  let pool = 0;
  for (const p of payments) {
    if (p.caseId !== null && liveIds.has(p.caseId))
      bound.set(p.caseId, (bound.get(p.caseId) ?? 0) + p.amount);
    else pool += p.amount;
  }

  const result = new Map<number, CaseShare>();
  const owing: { id: number; owes: number }[] = [];
  for (const c of live) {
    const own = Math.min(bound.get(c.id) ?? 0, c.total);
    pool += (bound.get(c.id) ?? 0) - own;
    result.set(c.id, { paid: own, remaining: c.total - own });
    owing.push({ id: c.id, owes: c.total - own });
  }

  let openingRemaining = Math.max(opening, 0);
  const useOnOpening = Math.min(pool, openingRemaining);
  openingRemaining -= useOnOpening;
  pool -= useOnOpening;

  for (const item of owing) {
    const use = Math.min(pool, item.owes);
    pool -= use;
    const share = result.get(item.id) as CaseShare;
    share.paid += use;
    share.remaining -= use;
  }
  return { cases: result, openingRemaining, credit: pool + Math.max(-opening, 0) };
}

export interface OpenCase extends LedgerCase {
  paid: number;
  remaining: number;
}

export interface Breakdown {
  /** Non-cancelled cases that still owe something, oldest first (the FIFO order of `allocate`). */
  openCases: OpenCase[];
  openingRemaining: number;
  /** Σ remaining of every open case, not of a page. */
  casesRemaining: number;
  credit: number;
  balance: number;
  /** openingRemaining + casesRemaining − credit === balance (SPEC §5.11 tie-out). */
  tiesOut: boolean;
}

/**
 * The debts breakdown of one doctor (B4): what makes up his balance. The tie-out
 * `openingRemaining + Σ remaining − credit = balance` is proven in docs/plans/b4-debts-reports-search.md §1.2
 * and checked here so a caller can refuse to show numbers that do not add up.
 */
export function breakdown(
  opening: number,
  cases: readonly LedgerCase[],
  counted: readonly CountedPayment[],
): Breakdown {
  const allocation = allocate(opening, cases, counted);
  const live = cases
    .filter((c) => !c.cancelled)
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.caseNo - b.caseNo);
  const openCases: OpenCase[] = [];
  let casesRemaining = 0;
  for (const c of live) {
    const share = allocation.cases.get(c.id);
    if (share && share.remaining > 0) {
      openCases.push({ ...c, paid: share.paid, remaining: share.remaining });
      casesRemaining += share.remaining;
    }
  }
  const balance = doctorBalance(
    opening,
    cases,
    counted.reduce((sum, p) => sum + p.amount, 0),
  );
  return {
    openCases,
    openingRemaining: allocation.openingRemaining,
    casesRemaining,
    credit: allocation.credit,
    balance,
    tiesOut: allocation.openingRemaining + casesRemaining - allocation.credit === balance,
  };
}

export type BalanceDirection = 'owed_to_lab' | 'owed_by_lab' | 'settled';

export const directionOf = (balance: number): BalanceDirection =>
  balance > 0 ? 'owed_to_lab' : balance < 0 ? 'owed_by_lab' : 'settled';

// ---------------------------------------------------------------- idempotency

/** Stable JSON: object keys sorted, undefined dropped, so equal requests hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const requestHash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
