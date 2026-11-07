import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney, MAX_AMOUNT_MINOR, parseMoney, sumMinor, toMoneyInput } from './money.ts';

describe('parseMoney', () => {
  it('reads whole and decimal amounts into minor units', () => {
    assert.deepEqual(parseMoney('120', 2), { ok: true, minor: 12000 });
    assert.deepEqual(parseMoney('120.5', 2), { ok: true, minor: 12050 });
    assert.deepEqual(parseMoney('0.07', 2), { ok: true, minor: 7 });
    assert.deepEqual(parseMoney('.5', 2), { ok: true, minor: 50 });
    assert.deepEqual(parseMoney('7.', 2), { ok: true, minor: 700 });
    assert.deepEqual(parseMoney('  1,234.50 ', 2), { ok: true, minor: 123450 });
    assert.deepEqual(parseMoney('15', 0), { ok: true, minor: 15 });
    assert.deepEqual(parseMoney('1.234', 3), { ok: true, minor: 1234 });
  });

  it('never loses a cent the way floats do', () => {
    // 0.1 + 0.2 style traps: these are exact in minor units.
    assert.deepEqual(parseMoney('0.29', 2), { ok: true, minor: 29 });
    assert.deepEqual(parseMoney('1.15', 2), { ok: true, minor: 115 });
    assert.deepEqual(parseMoney('9007199254.74', 2), { ok: true, minor: 900719925474 });
  });

  it('accepts Arabic-Indic digits and the Arabic decimal mark', () => {
    assert.deepEqual(parseMoney('٣٥٠٫٢٥', 2), { ok: true, minor: 35025 });
    assert.deepEqual(parseMoney('۱۲', 2), { ok: true, minor: 1200 });
  });

  it('handles signs only where allowed', () => {
    assert.deepEqual(parseMoney('-20', 2), { ok: false, error: 'negative' });
    assert.deepEqual(parseMoney('-20', 2, { allowNegative: true }), { ok: true, minor: -2000 });
    assert.deepEqual(parseMoney('−3.5', 2, { allowNegative: true }), { ok: true, minor: -350 });
    assert.deepEqual(parseMoney('-0', 2), { ok: true, minor: 0 });
    assert.deepEqual(parseMoney('+4', 2), { ok: true, minor: 400 });
  });

  it('rejects bad input instead of guessing', () => {
    for (const bad of ['abc', '1.2.3', '1,23', '12,34.5', '1 000', '1e3', '--1', '.', '-', '0x10', 'NaN']) {
      assert.equal(parseMoney(bad, 2).ok, false, bad);
    }
    assert.deepEqual(parseMoney('', 2), { ok: false, error: 'empty' });
    assert.deepEqual(parseMoney('   ', 2), { ok: false, error: 'empty' });
  });

  it('refuses more decimals than the currency has (no silent rounding)', () => {
    assert.deepEqual(parseMoney('1.005', 2), { ok: false, error: 'tooManyDecimals' });
    assert.deepEqual(parseMoney('3.5', 0), { ok: false, error: 'tooManyDecimals' });
  });

  it('keeps to the API maximum', () => {
    assert.deepEqual(parseMoney('9999999999.99', 2), { ok: true, minor: MAX_AMOUNT_MINOR });
    assert.deepEqual(parseMoney('10000000000', 2), { ok: false, error: 'tooLarge' });
    assert.deepEqual(parseMoney('-10000000000', 2, { allowNegative: true }), { ok: false, error: 'tooLarge' });
  });

  it('rejects invalid currency settings loudly', () => {
    assert.throws(() => parseMoney('1', 4), RangeError);
  });
});

describe('formatMoney / toMoneyInput', () => {
  it('formats with fixed decimals and grouping', () => {
    assert.equal(formatMoney(123450, 2), '1,234.50');
    assert.equal(formatMoney(7, 2), '0.07');
    assert.equal(formatMoney(-2000, 2), '-20.00');
    assert.equal(formatMoney(15, 0), '15');
    assert.equal(formatMoney(1234, 3), '1.234');
    assert.equal(formatMoney(MAX_AMOUNT_MINOR, 2), '9,999,999,999.99');
    assert.equal(formatMoney(123450, 2, 'ar-u-nu-latn'), '1,234.50');
  });

  it('gives input text that parses back to the same amount', () => {
    for (const [minor, decimals] of [
      [0, 2],
      [7, 2],
      [-2000, 2],
      [123456789, 2],
      [15, 0],
      [-1, 3],
    ] as const) {
      const text = toMoneyInput(minor, decimals);
      assert.deepEqual(parseMoney(text, decimals, { allowNegative: true }), { ok: true, minor }, text);
    }
    assert.equal(toMoneyInput(123450, 2), '1234.50');
  });

  it('refuses non-integer amounts (a float slipped in somewhere)', () => {
    assert.throws(() => formatMoney(12.5, 2), RangeError);
    assert.throws(() => toMoneyInput(Number.NaN, 2), RangeError);
  });
});

describe('sumMinor', () => {
  it('adds and subtracts integer minor units exactly', () => {
    assert.equal(sumMinor([]), 0);
    assert.equal(sumMinor([10, 20, 29]), 59);
    assert.equal(sumMinor([12000, 12000, -500]), 23500);
  });

  it('refuses fractions and out-of-range sums instead of losing precision', () => {
    assert.throws(() => sumMinor([0.1, 0.2]), RangeError);
    assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError);
  });
});
