import {
  allocate,
  allowedChequeStatuses,
  boundRoom,
  canChequeMove,
  CHEQUE_STATUSES,
  CountedPayment,
  directionOf,
  doctorBalance,
  dueState,
  formatVoucher,
  isCounted,
  LedgerCase,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  requestHash,
} from './payment-rules';

const kase = (id: number, receivedDate: string, total: number, cancelled = false): LedgerCase => ({
  id,
  caseNo: id,
  receivedDate,
  total,
  cancelled,
});
const pay = (amount: number, caseId: number | null = null): CountedPayment => ({ amount, caseId });

/** Σ remaining + openingRemaining − credit = balance, whatever the inputs. */
function tie(opening: number, cases: LedgerCase[], payments: CountedPayment[]) {
  const a = allocate(opening, cases, payments);
  const rem = [...a.cases.values()].reduce((s, c) => s + c.remaining, 0);
  const balance = doctorBalance(
    opening,
    cases,
    payments.reduce((s, p) => s + p.amount, 0),
  );
  expect(rem + a.openingRemaining - a.credit).toBe(balance);
  for (const c of cases.filter((x) => !x.cancelled)) {
    const s = a.cases.get(c.id)!;
    expect(s.paid + s.remaining).toBe(c.total);
    expect(s.paid).toBeGreaterThanOrEqual(0);
    expect(s.remaining).toBeGreaterThanOrEqual(0);
  }
  return { a, balance };
}

describe('isCounted (SPEC §7.4)', () => {
  it('covers the whole status × method × cheque-status matrix', () => {
    for (const status of PAYMENT_STATUSES)
      for (const method of PAYMENT_METHODS)
        for (const chequeStatus of [null, ...CHEQUE_STATUSES]) {
          const expected = status === 'active' && (method !== 'cheque' || chequeStatus === 'cleared');
          expect(isCounted({ status, method, chequeStatus })).toBe(expected);
        }
  });
});

describe('cheque transitions (D3)', () => {
  it('allows pending → cleared | returned and cleared → returned only', () => {
    const allowed: string[] = [];
    for (const from of CHEQUE_STATUSES)
      for (const to of CHEQUE_STATUSES) if (canChequeMove(from, to)) allowed.push(`${from}>${to}`);
    expect(allowed.sort()).toEqual(['cleared>returned', 'pending>cleared', 'pending>returned']);
  });
  it('offers nothing for a void payment or a returned cheque', () => {
    expect(allowedChequeStatuses('pending', true)).toEqual([]);
    expect(allowedChequeStatuses('returned', false)).toEqual([]);
    expect(allowedChequeStatuses('pending', false)).toEqual(['cleared', 'returned']);
  });
});

describe('dueState', () => {
  const c = { status: 'pending' as const, dueDate: '2026-11-10', paymentVoid: false };
  it('flags overdue, soon and none; only for pending cheques of active payments', () => {
    expect(dueState(c, '2026-11-11', '2026-11-18')).toBe('overdue');
    expect(dueState(c, '2026-11-10', '2026-11-17')).toBe('soon');
    expect(dueState({ ...c, dueDate: '2026-11-17' }, '2026-11-10', '2026-11-17')).toBe('soon');
    expect(dueState({ ...c, dueDate: '2026-11-18' }, '2026-11-10', '2026-11-17')).toBe('none');
    expect(dueState({ ...c, status: 'cleared' as const }, '2026-11-20', '2026-11-27')).toBe('none');
    expect(dueState({ ...c, paymentVoid: true }, '2026-11-20', '2026-11-27')).toBe('none');
  });
});

describe('small helpers', () => {
  it('formats vouchers', () => {
    expect(formatVoucher(1)).toBe('IN-000001');
    expect(formatVoucher(1234567)).toBe('IN-1234567');
  });
  it('room left for a bound payment never goes negative', () => {
    expect(boundRoom(500, 400)).toBe(100);
    expect(boundRoom(500, 700)).toBe(0);
  });
  it('directions', () => {
    expect([directionOf(5), directionOf(-5), directionOf(0)]).toEqual([
      'owed_to_lab',
      'owed_by_lab',
      'settled',
    ]);
  });
});

describe('allocate — plan example 1 (cheque lifecycle)', () => {
  const cases = [kase(101, '2026-11-01', 40_000), kase(102, '2026-11-03', 30_000)];
  it('pending: nothing counted', () => {
    const { a, balance } = tie(0, cases, []);
    expect(balance).toBe(70_000);
    expect(a.cases.get(101)).toEqual({ paid: 0, remaining: 40_000 });
  });
  it('cleared: FIFO pays the oldest case first', () => {
    const { a, balance } = tie(0, cases, [pay(50_000)]);
    expect(balance).toBe(20_000);
    expect(a.cases.get(101)).toEqual({ paid: 40_000, remaining: 0 });
    expect(a.cases.get(102)).toEqual({ paid: 10_000, remaining: 20_000 });
  });
  it('returned: back to the full debt', () => {
    expect(tie(0, cases, []).balance).toBe(70_000);
  });
});

describe('allocate — plan example 2 (bound + unbound, opening, cancelled case)', () => {
  const payments = [pay(12_000, 202), pay(25_000), pay(6_000, 203)];
  it('before the cancel: balance 320.00 and the shares tie', () => {
    const cases = [
      kase(201, '2026-11-01', 30_000),
      kase(202, '2026-11-02', 20_000),
      kase(203, '2026-11-04', 15_000),
    ];
    const { a, balance } = tie(10_000, cases, payments);
    expect(balance).toBe(32_000);
    expect(a.openingRemaining).toBe(0);
    expect(a.cases.get(201)).toEqual({ paid: 15_000, remaining: 15_000 });
    expect(a.cases.get(202)).toEqual({ paid: 12_000, remaining: 8_000 });
    expect(a.cases.get(203)).toEqual({ paid: 6_000, remaining: 9_000 });
  });
  it('after cancelling #203 its payment is account credit: balance 170.00', () => {
    const cases = [
      kase(201, '2026-11-01', 30_000),
      kase(202, '2026-11-02', 20_000),
      kase(203, '2026-11-04', 15_000, true),
    ];
    const { a, balance } = tie(10_000, cases, payments);
    expect(balance).toBe(17_000);
    expect(a.cases.get(201)).toEqual({ paid: 21_000, remaining: 9_000 });
    expect(a.cases.get(202)).toEqual({ paid: 12_000, remaining: 8_000 });
    expect(a.cases.has(203)).toBe(false);
  });
});

describe('allocate — edge cases', () => {
  it('example 3: overpayment is credit and the balance is negative', () => {
    const { a, balance } = tie(0, [kase(1, '2026-11-01', 10_000)], [pay(15_000)]);
    expect(balance).toBe(-5_000);
    expect(a.credit).toBe(5_000);
    expect(a.cases.get(1)).toEqual({ paid: 10_000, remaining: 0 });
  });
  it('a bound payment above a lowered case total spills to the next case', () => {
    const cases = [kase(1, '2026-11-01', 5_000), kase(2, '2026-11-02', 9_000)];
    const { a } = tie(0, cases, [pay(8_000, 1)]);
    expect(a.cases.get(1)).toEqual({ paid: 5_000, remaining: 0 });
    expect(a.cases.get(2)).toEqual({ paid: 3_000, remaining: 6_000 });
  });
  it('ties on the received date are broken by case number', () => {
    const cases = [kase(9, '2026-11-01', 100), kase(3, '2026-11-01', 100)];
    const { a } = tie(0, cases, [pay(100)]);
    expect(a.cases.get(3)).toEqual({ paid: 100, remaining: 0 });
    expect(a.cases.get(9)).toEqual({ paid: 0, remaining: 100 });
  });
  it('a negative opening balance only lowers the balance (credit)', () => {
    const { a, balance } = tie(-3_000, [kase(1, '2026-11-01', 10_000)], []);
    expect(balance).toBe(7_000);
    expect(a.credit).toBe(3_000);
    expect(a.cases.get(1)).toEqual({ paid: 0, remaining: 10_000 });
  });
  it('a positive opening balance is paid before any case', () => {
    const { a } = tie(4_000, [kase(1, '2026-11-01', 10_000)], [pay(5_000)]);
    expect(a.openingRemaining).toBe(0);
    expect(a.cases.get(1)).toEqual({ paid: 1_000, remaining: 9_000 });
  });
  it('handles empty input and amounts near the limit without float drift', () => {
    expect(tie(0, [], []).balance).toBe(0);
    const big = 999_999_999_999;
    tie(big, [kase(1, '2026-11-01', big)], [pay(big, 1), pay(1)]);
  });
  it('does not depend on the order of payments or cases (property check, 300 random sets)', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const cases = Array.from({ length: rnd(6) }, (_, k) =>
        kase(k + 1, `2026-11-${String(1 + rnd(9)).padStart(2, '0')}`, rnd(50_000), rnd(5) === 0),
      );
      const payments = Array.from({ length: rnd(7) }, () =>
        pay(1 + rnd(40_000), cases.length && rnd(2) ? 1 + rnd(cases.length + 1) : null),
      );
      const opening = rnd(20_000) - 5_000;
      const { a } = tie(opening, cases, payments);
      const again = allocate(opening, [...cases].reverse(), [...payments].reverse());
      expect([...again.cases.entries()].sort()).toEqual([...a.cases.entries()].sort());
      expect(again.credit).toBe(a.credit);
      expect(again.openingRemaining).toBe(a.openingRemaining);
    }
  });
});

describe('requestHash', () => {
  it('ignores key order and undefined, but not values', () => {
    expect(requestHash({ a: 1, b: { c: 2, d: undefined } })).toBe(requestHash({ b: { c: 2 }, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });
});
