import {
  allocate,
  breakdown,
  CountedPayment,
  CountedRefund,
  doctorBalance,
  formatVoucher,
  LedgerCase,
  parseVoucher,
  refundable,
} from './payment-rules';

const kase = (id: number, receivedDate: string, total: number, cancelled = false): LedgerCase => ({
  id,
  caseNo: id,
  receivedDate,
  total,
  cancelled,
});
const pay = (amount: number, caseId: number | null = null): CountedPayment => ({ amount, caseId });
const refund = (id: number, date: string, amount: number): CountedRefund => ({ id, voucherNo: id, date, amount });
const remainingOf = (b: ReturnType<typeof breakdown>) => b.openCases.map((c) => [c.caseNo, c.remaining]);
const refundsOf = (b: ReturnType<typeof breakdown>) => b.openRefunds.map((r) => [r.voucherNo, r.covered, r.remaining]);

describe('refunds in the ledger — worked examples of docs/plans/b4b-outgoing-expenses.md §2.4', () => {
  // Doctor F: case 100.00, cash 150.00 unbound → credit 50.00.
  const fCases = [kase(501, '2026-11-01', 10000)];
  const fPaid = [pay(15000)];

  it('R0 — before any refund: −50.00, refundable 50.00', () => {
    const b = breakdown(0, fCases, fPaid);
    expect(b.balance).toBe(-5000);
    expect(b.credit).toBe(5000);
    expect(refundable(b.balance, 0)).toBe(5000);
  });

  it('R1 — full refund of the overpayment: balance 0, nothing open, no credit', () => {
    const b = breakdown(0, fCases, fPaid, [refund(1, '2026-11-05', 5000)]);
    expect(b.balance).toBe(0);
    expect(b.openCases).toEqual([]);
    expect(b.openRefunds).toEqual([]);
    expect(b.refundsRemaining).toBe(0);
    expect(b.credit).toBe(0);
    expect(b.tiesOut).toBe(true);
    expect(allocate(0, fCases, fPaid, [refund(1, '2026-11-05', 5000)]).refunds.get(1)).toEqual({
      covered: 5000,
      remaining: 0,
    });
  });

  it('R2 — partial refund 30.00: balance −20.00, credit 20.00, refundable 20.00', () => {
    const b = breakdown(0, fCases, fPaid, [refund(1, '2026-11-05', 3000)]);
    expect(b.balance).toBe(-2000);
    expect(b.credit).toBe(2000);
    expect(b.refundsRemaining).toBe(0);
    expect(b.tiesOut).toBe(true);
    expect(refundable(b.balance, 0)).toBe(2000);
  });

  it('R3 — refund, then his own cheque bounces: 300.00 = case 200 + refund 100', () => {
    const cases = [kase(601, '2026-11-01', 20000)];
    const refunds = [refund(3, '2026-11-05', 10000)];
    // While the cheque is cleared: credit 100 was refunded → 0.
    const cleared = breakdown(0, cases, [pay(30000)], refunds);
    expect(cleared.balance).toBe(0);
    expect(cleared.tiesOut).toBe(true);
    // The cheque returns: it no longer counts.
    const bounced = breakdown(0, cases, [], refunds);
    expect(bounced.balance).toBe(30000);
    expect(remainingOf(bounced)).toEqual([[601, 20000]]);
    expect(refundsOf(bounced)).toEqual([[3, 0, 10000]]);
    expect(bounced.refundsRemaining).toBe(10000);
    expect(bounced.credit).toBe(0);
    expect(bounced.tiesOut).toBe(true);
    expect(refundable(bounced.balance, 0)).toBe(0);
  });

  it('R4 — refund by cheque: pending reserves the credit, cleared counts, returned gives it back', () => {
    const pending = breakdown(0, fCases, fPaid);
    expect(pending.balance).toBe(-5000);
    expect(refundable(pending.balance, 5000)).toBe(0);
    const cleared = breakdown(0, fCases, fPaid, [refund(4, '2026-11-08', 5000)]);
    expect(cleared.balance).toBe(0);
    expect(cleared.tiesOut).toBe(true);
    const returned = breakdown(0, fCases, fPaid);
    expect(returned.balance).toBe(-5000);
    expect(refundable(returned.balance, 0)).toBe(5000);
  });

  it('R5 — a refund dated before a later case is paid first: case B stays open 70.00', () => {
    const cases = [kase(1, '2026-11-01', 10000), kase(2, '2026-11-10', 7000)];
    const b = breakdown(0, cases, [pay(15000)], [refund(5, '2026-11-05', 5000)]);
    expect(b.balance).toBe(7000);
    expect(remainingOf(b)).toEqual([[2, 7000]]);
    expect(b.refundsRemaining).toBe(0);
    expect(b.tiesOut).toBe(true);
  });

  it('R6 — expenses are not ledger input: no refunds = exactly the B4 result', () => {
    const cases = [kase(201, '2026-11-01', 30000), kase(202, '2026-11-02', 20000), kase(203, '2026-11-04', 15000)];
    const paid = [pay(12000, 202), pay(25000), pay(6000, 203)];
    expect(breakdown(10000, cases, paid, [])).toEqual(breakdown(10000, cases, paid));
    expect(allocate(10000, cases, paid, [])).toEqual(allocate(10000, cases, paid));
  });

  it('R7 — a doctor who owes money has nothing refundable', () => {
    const cases = [kase(201, '2026-11-01', 30000), kase(202, '2026-11-02', 20000), kase(203, '2026-11-04', 15000)];
    const b = breakdown(10000, cases, [pay(12000, 202), pay(25000), pay(6000, 203)]);
    expect(b.balance).toBe(32000);
    expect(refundable(b.balance, 0)).toBe(0);
  });

  it('same date: the case comes before the refund; then by number', () => {
    const cases = [kase(9, '2026-11-05', 5000)];
    // Pool 5000 pays the case first (same date), the refund stays open.
    const b = breakdown(0, cases, [pay(5000)], [refund(1, '2026-11-05', 2000)]);
    expect(remainingOf(b)).toEqual([]);
    expect(refundsOf(b)).toEqual([[1, 0, 2000]]);
    expect(b.tiesOut).toBe(true);
    const two = allocate(0, [], [pay(1000)], [refund(8, '2026-11-01', 1000), refund(7, '2026-11-01', 1000)]);
    expect(two.refunds.get(7)).toEqual({ covered: 1000, remaining: 0 });
    expect(two.refunds.get(8)).toEqual({ covered: 0, remaining: 1000 });
  });

  it('the positive opening balance stays the oldest item, before a refund dated earlier than every case', () => {
    const b = breakdown(4000, [kase(1, '2026-11-10', 1000)], [pay(4000)], [refund(1, '2026-01-01', 1000)]);
    expect(b.openingRemaining).toBe(0);
    expect(refundsOf(b)).toEqual([[1, 0, 1000]]);
    expect(remainingOf(b)).toEqual([[1, 1000]]);
    expect(b.balance).toBe(2000);
    expect(b.tiesOut).toBe(true);
  });

  it('a negative opening balance is credit and covers a refund', () => {
    const b = breakdown(-5000, [], [], [refund(1, '2026-11-01', 5000)]);
    expect(b.balance).toBe(0);
    // The negative opening is not in the pool: the refund stays uncovered and the credit offsets it.
    expect(b.refundsRemaining).toBe(5000);
    expect(b.credit).toBe(5000);
    expect(b.tiesOut).toBe(true);
  });
});

describe('voucher numbers', () => {
  it('formats both series', () => {
    expect(formatVoucher(12)).toBe('IN-000012');
    expect(formatVoucher(12, 'in')).toBe('IN-000012');
    expect(formatVoucher(12, 'out')).toBe('OUT-000012');
    expect(formatVoucher(1234567, 'out')).toBe('OUT-1234567');
  });
  it.each([
    ['OUT-000012', { no: 12, direction: 'out' }],
    ['out12', { no: 12, direction: 'out' }],
    ['Out 7', { no: 7, direction: 'out' }],
    ['IN-3', { no: 3, direction: 'in' }],
    ['in3', { no: 3, direction: 'in' }],
    ['42', { no: 42, direction: null }],
  ])('parses %s', (text, expected) => {
    expect(parseVoucher(text)).toEqual(expected);
  });
  it.each(['', 'OUT-', 'x12', 'OUT-12a', 'outin12', '-'])('rejects %p', (text) => {
    expect(parseVoucher(text)).toBeNull();
  });
});

describe('refundable', () => {
  it.each([
    [-5000, 0, 5000],
    [-5000, 2000, 3000],
    [-5000, 5000, 0],
    [-5000, 9000, 0],
    [0, 0, 0],
    [3000, 0, 0],
  ])('balance %i, pending refund cheques %i → %i', (balance, pending, expected) => {
    expect(refundable(balance, pending)).toBe(expected);
  });
});

describe('refunds — property: the extended tie-out always holds', () => {
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it.each([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])('seed %i: 200 random ledgers with refunds', (seed) => {
    const r = rng(seed);
    const int = (max: number) => Math.floor(r() * (max + 1));
    const date = () => `2026-0${1 + int(8)}-1${int(9)}`;
    for (let run = 0; run < 200; run++) {
      const n = int(8);
      const cases: LedgerCase[] = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        caseNo: i + 1,
        receivedDate: date(),
        total: int(100_000),
        cancelled: r() < 0.2,
      }));
      const opening = int(200_000) - 100_000;
      const payments: CountedPayment[] = Array.from({ length: int(10) }, () => ({
        amount: 1 + int(80_000),
        caseId: n > 0 && r() < 0.5 ? 1 + int(n - 1) : null,
      }));
      const refunds: CountedRefund[] = Array.from({ length: int(4) }, (_, i) => ({
        id: i + 1,
        voucherNo: i + 1,
        date: date(),
        amount: 1 + int(60_000),
      }));
      // The "bounce" shape: the refunds stay while some payments stop counting (dropped at random).
      const afterBounce = payments.filter(() => r() < 0.6);
      for (const counted of [payments, afterBounce]) {
        const b = breakdown(opening, cases, counted, refunds);
        const label = `seed ${seed} run ${run}`;
        expect({ label, ok: b.tiesOut }).toEqual({ label, ok: true });
        const balance = doctorBalance(
          opening,
          cases,
          counted.reduce((s, p) => s + p.amount, 0),
          refunds.reduce((s, x) => s + x.amount, 0),
        );
        expect(b.balance).toBe(balance);
        const a = allocate(opening, cases, counted, refunds);
        for (const c of b.openCases) {
          expect(c.remaining).toBeGreaterThan(0);
          expect(c.remaining).toBe(a.cases.get(c.id)?.remaining);
          expect(c.paid + c.remaining).toBe(c.total);
        }
        for (const x of refunds) {
          const share = a.refunds.get(x.id);
          expect(share && share.covered + share.remaining).toBe(x.amount);
          expect(share && share.covered).toBeGreaterThanOrEqual(0);
        }
        // Credit only when nothing is owed by the pool (no item left owing while money sits in the pool).
        if (a.credit - Math.max(-opening, 0) > 0) {
          expect(b.casesRemaining + b.refundsRemaining + b.openingRemaining).toBe(0);
        }
        // Permutation of payments and refunds gives the same result.
        const shuffled = allocate(opening, cases, [...counted].reverse(), [...refunds].reverse());
        expect(shuffled.refundsRemaining).toBe(a.refundsRemaining);
        expect(shuffled.credit).toBe(a.credit);
      }
    }
  });

  it('mutation check: refunds left out of the balance (a balancesCte without paid_out) are caught', () => {
    const cases = [kase(1, '2026-11-01', 10000)];
    const refunds = [refund(1, '2026-11-05', 3000)];
    const a = allocate(0, cases, [pay(15000)], refunds);
    const rem = [...a.cases.values()].reduce((s, c) => s + c.remaining, 0);
    const good = doctorBalance(0, cases, 15000, 3000);
    const wrong = doctorBalance(0, cases, 15000); // forgot paid_out
    expect(rem + a.openingRemaining + a.refundsRemaining - a.credit).toBe(good);
    expect(rem + a.openingRemaining + a.refundsRemaining - a.credit === wrong).toBe(false);
  });

  it('mutation check: refunds left out of the allocation (but in the balance) are caught', () => {
    const cases = [kase(1, '2026-11-01', 20000)];
    const a = allocate(0, cases, [], []); // forgot the refund
    const rem = [...a.cases.values()].reduce((s, c) => s + c.remaining, 0);
    const balance = doctorBalance(0, cases, 0, 10000); // R3 after the bounce
    expect(rem + a.openingRemaining + a.refundsRemaining - a.credit === balance).toBe(false);
  });
});
