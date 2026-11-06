import {
  hasLabName,
  isCounterLocked,
  isValidTimeZone,
  lockedCurrencyFields,
  withNewStart,
} from './settings-rules';

describe('currency lock', () => {
  const ils = { code: 'ILS', symbol: '₪', decimals: 2 };

  it('allows any change while no money amount exists', () => {
    expect(lockedCurrencyFields(ils, { code: 'JOD', decimals: 3, symbol: 'JD' }, false)).toEqual([]);
  });

  it('locks code and decimals once money exists, but never the symbol', () => {
    expect(lockedCurrencyFields(ils, { code: 'JOD', decimals: 3, symbol: 'JD' }, true)).toEqual([
      'code',
      'decimals',
    ]);
    expect(lockedCurrencyFields(ils, { symbol: 'ش.ج' }, true)).toEqual([]);
  });

  it('does not treat re-sending the same values as a change', () => {
    expect(lockedCurrencyFields(ils, { code: 'ILS', decimals: 2 }, true)).toEqual([]);
  });
});

describe('numbering start (addition C)', () => {
  it('is unlocked while next_value equals start_value', () => {
    expect(isCounterLocked({ startValue: 1, nextValue: 1 })).toBe(false);
    expect(isCounterLocked({ startValue: 500, nextValue: 500 })).toBe(false);
  });

  it('moves next_value together with the new start', () => {
    expect(withNewStart({ startValue: 1, nextValue: 1 }, 1001)).toEqual({
      startValue: 1001,
      nextValue: 1001,
    });
    // Lowering it again is fine while nothing was issued.
    expect(withNewStart({ startValue: 1001, nextValue: 1001 }, 7)).toEqual({ startValue: 7, nextValue: 7 });
  });

  it('refuses any change after a number was issued', () => {
    expect(isCounterLocked({ startValue: 1001, nextValue: 1002 })).toBe(true);
    expect(withNewStart({ startValue: 1001, nextValue: 1002 }, 5000)).toBeNull();
    expect(withNewStart({ startValue: 1001, nextValue: 1002 }, 1001)).toBeNull();
  });
});

describe('lab profile', () => {
  it('needs a name in at least one language', () => {
    expect(hasLabName({ nameAr: 'مختبر', nameEn: null })).toBe(true);
    expect(hasLabName({ nameAr: null, nameEn: 'Lab' })).toBe(true);
    expect(hasLabName({ nameAr: '  ', nameEn: null })).toBe(false);
  });

  it.each([
    ['Asia/Hebron', true],
    ['Asia/Jerusalem', true],
    ['UTC', true],
    ['Mars/Olympus', false],
    ['', false],
  ])('time zone %p valid=%p', (tz, valid) => {
    expect(isValidTimeZone(tz)).toBe(valid);
  });
});
