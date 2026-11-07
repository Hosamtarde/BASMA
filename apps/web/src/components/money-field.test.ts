import { describe, expect, it } from 'vitest';
import { checkLogoFile, MAX_LOGO_BYTES } from '@/features/settings/api';
import { moneySchema } from './money-field';

describe('moneySchema (minor units, no floats)', () => {
  it('turns typed text into integer minor units for the currency', () => {
    expect(moneySchema(2).parse('1,250.5')).toBe(125050);
    expect(moneySchema(0).parse('15')).toBe(15);
    expect(moneySchema(3).parse('1.234')).toBe(1234);
  });

  it('gives a catalog key, not a rounded guess, for bad input', () => {
    const issue = (schema: ReturnType<typeof moneySchema>, text: string) =>
      schema.safeParse(text).error?.issues[0]?.message;
    expect(issue(moneySchema(2), '1.005')).toBe('validation.moneyDecimals|{"count":2}');
    expect(issue(moneySchema(2), '-5')).toBe('validation.moneyNegative');
    expect(issue(moneySchema(2), 'abc')).toBe('validation.moneyFormat');
    expect(issue(moneySchema(2), '')).toBe('validation.required');
  });

  it('signed and optional for opening balances', () => {
    const schema = moneySchema(2, { allowNegative: true, optional: true });
    expect(schema.parse('-50.5')).toBe(-5050);
    expect(schema.parse('')).toBe(0);
  });
});

describe('checkLogoFile (before upload; the server checks again)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

  it('accepts real PNG and JPEG files up to 1 MB', async () => {
    expect(await checkLogoFile(new File([png], 'a.png', { type: 'image/png' }))).toBeNull();
    expect(await checkLogoFile(new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))).toBeNull();
  });

  it('refuses other types, files whose bytes are not an image, empty and oversized files', async () => {
    expect(await checkLogoFile(new File([png], 'a.gif', { type: 'image/gif' }))).toBe('type');
    expect(await checkLogoFile(new File(['hello'], 'a.png', { type: 'image/png' }))).toBe('type');
    expect(await checkLogoFile(new File([], 'a.png', { type: 'image/png' }))).toBe('empty');
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(png);
    expect(await checkLogoFile(new File([big], 'a.png', { type: 'image/png' }))).toBe('size');
  });
});
