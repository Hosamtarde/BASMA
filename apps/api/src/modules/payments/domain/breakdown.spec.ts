import { allocate, breakdown, CountedPayment, doctorBalance, LedgerCase } from './payment-rules';

const kase = (id: number, receivedDate: string, total: number, cancelled = false): LedgerCase => ({
  id,
  caseNo: id,
  receivedDate,
  total,
  cancelled,
});
const pay = (amount: number, caseId: number | null = null): CountedPayment => ({ amount, caseId });
const remainingOf = (b: ReturnType<typeof breakdown>) => b.openCases.map((c) => [c.caseNo, c.remaining]);

describe('breakdown — worked examples of docs/plans/b4-debts-reports-search.md §1.3', () => {
  const e1Cases = [kase(201, '2026-11-01', 30000), kase(202, '2026-11-02', 20000), kase(203, '2026-11-04', 15000)];
  const e1Pay = [pay(12000, 202), pay(25000), pay(6000, 203)];

  it('E1 — opening, bound and unbound payments: 320.00 = 150 + 80 + 90', () => {
    const b = breakdown(10000, e1Cases, e1Pay);
    expect(b.balance).toBe(32000);
    expect(remainingOf(b)).toEqual([
      [201, 15000],
      [202, 8000],
      [203, 9000],
    ]);
    expect(b.openingRemaining).toBe(0);
    expect(b.credit).toBe(0);
    expect(b.casesRemaining).toBe(32000);
    expect(b.tiesOut).toBe(true);
  });

  it('E1 after cancelling #203: 170.00 = 90 + 80', () => {
    const cases = [e1Cases[0]!, e1Cases[1]!, { ...e1Cases[2]!, cancelled: true }];
    const b = breakdown(10000, cases, e1Pay);
    expect(b.balance).toBe(17000);
    expect(remainingOf(b)).toEqual([
      [201, 9000],
      [202, 8000],
    ]);
    expect(b.tiesOut).toBe(true);
  });

  it('E2 — cheque lifecycle: pending, cleared, returned', () => {
    const cases = [kase(101, '2026-11-01', 40000), kase(102, '2026-11-03', 30000)];
    const pending = breakdown(0, cases, []);
    expect(pending.balance).toBe(70000);
    expect(remainingOf(pending)).toEqual([
      [101, 40000],
      [102, 30000],
    ]);
    const cleared = breakdown(0, cases, [pay(50000)]);
    expect(cleared.balance).toBe(20000);
    expect(remainingOf(cleared)).toEqual([[102, 20000]]);
    const returned = breakdown(0, cases, []);
    expect(returned.balance).toBe(70000);
    for (const b of [pending, cleared, returned]) expect(b.tiesOut).toBe(true);
  });

  it('E3 — overpayment: −50.00, no open case, credit 50.00', () => {
    const b = breakdown(0, [kase(1, '2026-11-01', 10000)], [pay(15000)]);
    expect(b.balance).toBe(-5000);
    expect(b.openCases).toEqual([]);
    expect(b.credit).toBe(5000);
    expect(b.tiesOut).toBe(true);
  });

  it('E4 — negative opening balance is credit: 20.00 = 70 − 50', () => {
    const b = breakdown(-5000, [kase(301, '2026-11-01', 10000)], [pay(3000)]);
    expect(b.balance).toBe(2000);
    expect(remainingOf(b)).toEqual([[301, 7000]]);
    expect(b.openingRemaining).toBe(0);
    expect(b.credit).toBe(5000);
    expect(b.tiesOut).toBe(true);
  });

  it('E5 — a pending cheque is not a payment: balance 200.00, nothing paid', () => {
    const b = breakdown(0, [kase(1, '2026-11-01', 20000)], []);
    expect(b.balance).toBe(20000);
    expect(b.openCases[0]?.paid).toBe(0);
    expect(b.tiesOut).toBe(true);
  });

  it('keeps an unpaid positive opening balance as its own line', () => {
    const b = breakdown(10000, [kase(1, '2026-11-01', 5000)], [pay(4000)]);
    expect(b.openingRemaining).toBe(6000);
    expect(remainingOf(b)).toEqual([[1, 5000]]);
    expect(b.balance).toBe(11000);
    expect(b.tiesOut).toBe(true);
  });
});

describe('breakdown — property: it always ties out and never disagrees with allocate', () => {
  /** Small deterministic PRNG (mulberry32) so a failure is reproducible from the printed seed. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i: 200 random ledgers', (seed) => {
    const r = rng(seed);
    const int = (max: number) => Math.floor(r() * (max + 1));
    for (let run = 0; run < 200; run++) {
      const n = int(8);
      const cases: LedgerCase[] = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        caseNo: i + 1,
        receivedDate: `2026-0${1 + int(8)}-1${int(9)}`,
        total: int(100_000),
        cancelled: r() < 0.2,
      }));
      const opening = int(200_000) - 100_000;
      const payments: CountedPayment[] = Array.from({ length: int(10) }, () => ({
        amount: 1 + int(80_000),
        caseId: n > 0 && r() < 0.5 ? 1 + int(n - 1) : null,
      }));
      const b = breakdown(opening, cases, payments);
      const label = `seed ${seed} run ${run}`;
      expect({ label, ok: b.tiesOut }).toEqual({ label, ok: true });
      expect(b.balance).toBe(
        doctorBalance(
          opening,
          cases,
          payments.reduce((s, p) => s + p.amount, 0),
        ),
      );
      const a = allocate(opening, cases, payments);
      for (const c of b.openCases) {
        expect(c.remaining).toBeGreaterThan(0);
        expect(c.remaining).toBe(a.cases.get(c.id)?.remaining);
        expect(c.paid + c.remaining).toBe(c.total);
      }
      // Oldest first.
      const keys = b.openCases.map((c) => `${c.receivedDate}|${String(c.caseNo).padStart(6, '0')}`);
      expect(keys).toEqual([...keys].sort());
    }
  });

  it('mutation check: a wrong allocation is caught by the tie-out', () => {
    const cases = [kase(1, '2026-11-01', 10000)];
    const good = breakdown(0, cases, [pay(4000)]);
    expect(good.tiesOut).toBe(true);
    // A bug that forgets a payment in the allocation but not in the balance: simulate by feeding the
    // allocation fewer payments than the balance sees.
    const a = allocate(0, cases, []);
    const rem = [...a.cases.values()].reduce((s, c) => s + c.remaining, 0);
    const balance = doctorBalance(0, cases, 4000);
    expect(rem + a.openingRemaining - a.credit === balance).toBe(false);
  });
});
