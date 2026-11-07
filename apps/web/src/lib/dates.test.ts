import { describe, expect, it } from 'vitest';
import { isIsoDate, isoToLocalDate, localDateToIso, maskIsoDate } from './dates';

describe('maskIsoDate', () => {
  it('inserts the dashes while typing and keeps at most 8 digits', () => {
    expect(maskIsoDate('2')).toBe('2');
    expect(maskIsoDate('2026')).toBe('2026');
    expect(maskIsoDate('20261')).toBe('2026-1');
    expect(maskIsoDate('202611')).toBe('2026-11');
    expect(maskIsoDate('2026110')).toBe('2026-11-0');
    expect(maskIsoDate('20261107')).toBe('2026-11-07');
    expect(maskIsoDate('2026-11-07999')).toBe('2026-11-07');
  });

  it('drops anything that is not a digit and reads Arabic-Indic digits', () => {
    expect(maskIsoDate('2026/11/07')).toBe('2026-11-07');
    expect(maskIsoDate('abc')).toBe('');
    expect(maskIsoDate('٢٠٢٦١١٠٧')).toBe('2026-11-07');
  });
});

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-11-07')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-11-7')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('calendar conversion', () => {
  it('round-trips without a time-zone shift', () => {
    const d = isoToLocalDate('2026-03-29');
    expect(d?.getDate()).toBe(29);
    expect(localDateToIso(d!)).toBe('2026-03-29');
    expect(isoToLocalDate('2026-02-30')).toBeUndefined();
  });
});
