import {
  CASE_DUE_SOON_DAYS,
  collectPhase,
  duePhase,
  notificationKey,
  visibleTypes,
} from './notification-rules';

describe('duePhase', () => {
  it.each([
    ['yesterday', '2026-11-09', '2026-11-10', 'overdue'],
    ['today', '2026-11-10', '2026-11-10', 'soon'],
    ['in 2 days', '2026-11-12', '2026-11-10', 'soon'],
    ['in 3 days', '2026-11-13', '2026-11-10', null],
    ['across a month end', '2026-12-01', '2026-11-30', 'soon'],
    ['across a year end (soon)', '2027-01-01', '2026-12-31', 'soon'],
    ['across a year end (overdue)', '2026-12-31', '2027-01-01', 'overdue'],
  ])('%s', (_l, date, today, phase) => {
    expect(duePhase(date, today, CASE_DUE_SOON_DAYS)).toBe(phase);
  });
  it('cheques use 7 days', () => {
    expect(duePhase('2026-11-17', '2026-11-10', 7)).toBe('soon');
    expect(duePhase('2026-11-18', '2026-11-10', 7)).toBeNull();
  });
});

describe('collectPhase', () => {
  it.each([
    ['today, owed', '2026-11-10', 500, 'due'],
    ['passed, owed', '2026-11-01', 500, 'due'],
    ['tomorrow', '2026-11-11', 500, null],
    ['paid in full since', '2026-11-01', 0, null],
  ])('%s', (_l, on, remaining, phase) => {
    expect(collectPhase(on, '2026-11-10', remaining)).toBe(phase);
  });
});

describe('notificationKey', () => {
  it('changes with the phase and the date, so a hidden item can come back', () => {
    const soon = notificationKey('case_due', 41, 'soon', '2026-11-12');
    expect(soon).toBe('case_due:41:soon:2026-11-12');
    expect(notificationKey('case_due', 41, 'overdue', '2026-11-12')).not.toBe(soon);
    expect(notificationKey('case_due', 41, 'soon', '2026-11-13')).not.toBe(soon);
    expect(notificationKey('cheque_out_due', 999_999_999_999, 'overdue', '2026-11-12').length).toBeLessThanOrEqual(100);
  });
});

describe('visibleTypes', () => {
  it('shows only what the caller may read', () => {
    expect(visibleTypes(['cases.read'])).toEqual(['case_due']);
    expect(visibleTypes(['cases.read', 'cheques.read'])).toEqual(['case_due', 'cheque_in_due']);
    expect(visibleTypes(['cases.read', 'cheques.read', 'expenses.read', 'ledger.read'])).toEqual([
      'case_due',
      'cheque_in_due',
      'cheque_out_due',
      'collect_due',
    ]);
    expect(visibleTypes([])).toEqual([]);
  });
});
