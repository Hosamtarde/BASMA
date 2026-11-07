import {
  canCancel,
  caseActions,
  CASE_STATUSES,
  CaseStatus,
  checkTransition,
  isFdiTooth,
  isOverdue,
  resolvePrice,
  subtotalOf,
  summarizeCounts,
  totalOf,
} from './case-rules';

describe('status machine (full matrix)', () => {
  const allowed: Record<CaseStatus, CaseStatus[]> = {
    waiting: ['design', 'in_progress', 'ready', 'delivered'],
    design: ['waiting', 'in_progress', 'ready', 'delivered'],
    in_progress: ['waiting', 'design', 'ready', 'delivered'],
    ready: ['waiting', 'design', 'in_progress', 'delivered'],
    delivered: ['returned'],
    returned: ['in_progress', 'ready', 'delivered'],
    cancelled: [],
  };

  for (const from of CASE_STATUSES) {
    for (const to of CASE_STATUSES) {
      const expected = from === to ? 'same' : allowed[from].includes(to) ? 'ok' : 'invalid';
      it(`${from} → ${to}: ${expected}`, () => {
        expect(checkTransition(from, to)).toBe(expected);
      });
    }
  }

  it('cancel only before delivery; never from delivered, returned or cancelled', () => {
    expect(CASE_STATUSES.filter(canCancel)).toEqual(['waiting', 'design', 'in_progress', 'ready']);
  });

  it.each(CASE_STATUSES)('exposes the same rules as UI actions for %s', (status) => {
    expect(caseActions(status)).toEqual({
      allowedStatuses: allowed[status],
      canCancel: canCancel(status),
      canEdit: status !== 'cancelled',
    });
  });
});

describe('FDI teeth', () => {
  it('accepts exactly the 32 permanent teeth', () => {
    const valid = Array.from({ length: 100 }, (_, n) => n).filter(isFdiTooth);
    expect(valid).toHaveLength(32);
    expect(valid.slice(0, 8)).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    expect(valid.at(-1)).toBe(48);
  });

  it.each([10, 19, 20, 29, 30, 49, 51, 85, 11.5, -11])('rejects %p', (tooth) => {
    expect(isFdiTooth(tooth)).toBe(false);
  });
});

describe('price resolution (SPEC §7.5)', () => {
  it('manual beats special beats general', () => {
    expect(resolvePrice(200, 150, 90)).toEqual({ unitPrice: 90, priceSource: 'manual' });
    expect(resolvePrice(200, 150)).toEqual({ unitPrice: 150, priceSource: 'special' });
    expect(resolvePrice(200, null)).toEqual({ unitPrice: 200, priceSource: 'general' });
  });

  it('a special price of 0 is still a special price; a manual 0 is allowed', () => {
    expect(resolvePrice(200, 0)).toEqual({ unitPrice: 0, priceSource: 'special' });
    expect(resolvePrice(200, 150, 0)).toEqual({ unitPrice: 0, priceSource: 'manual' });
  });
});

describe('totals', () => {
  it('total = Σ lines − discount, never negative', () => {
    expect(subtotalOf([{ unitPrice: 100 }, { unitPrice: 250 }])).toBe(350);
    expect(totalOf(350, 50)).toBe(300);
    expect(totalOf(350, 350)).toBe(0);
    expect(totalOf(350, 351)).toBeNull();
    expect(subtotalOf([])).toBe(0);
  });
});

describe('overdue', () => {
  const today = '2026-11-11';
  it('is overdue only after the expected date and while still in the lab', () => {
    expect(isOverdue({ status: 'in_progress', expectedDate: '2026-11-10' }, today)).toBe(true);
    expect(isOverdue({ status: 'returned', expectedDate: '2026-11-10' }, today)).toBe(true);
    expect(isOverdue({ status: 'in_progress', expectedDate: '2026-11-11' }, today)).toBe(false);
    expect(isOverdue({ status: 'delivered', expectedDate: '2026-11-01' }, today)).toBe(false);
    expect(isOverdue({ status: 'cancelled', expectedDate: '2026-11-01' }, today)).toBe(false);
  });
});

describe('summarizeCounts', () => {
  it('gives every status a count (zero when absent) and sums total and overdue', () => {
    const out = summarizeCounts([
      { status: 'design', count: 3, overdue: 1 },
      { status: 'delivered', count: 5, overdue: 0 },
    ]);
    expect(out.byStatus).toEqual({
      waiting: 0,
      design: 3,
      in_progress: 0,
      ready: 0,
      delivered: 5,
      returned: 0,
      cancelled: 0,
    });
    expect(out.total).toBe(8);
    expect(out.overdue).toBe(1);
  });

  it('is all zeros for no rows', () => {
    const out = summarizeCounts([]);
    expect(out.total).toBe(0);
    expect(out.overdue).toBe(0);
    expect(Object.values(out.byStatus).every((n) => n === 0)).toBe(true);
    expect(Object.keys(out.byStatus)).toEqual([...CASE_STATUSES]);
  });
});
