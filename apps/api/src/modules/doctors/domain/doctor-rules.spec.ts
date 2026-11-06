import { mayHardDelete, PHONE_PATTERN } from './doctor-rules';

describe('doctor rules', () => {
  it('allows hard delete only with a zero opening balance (addition A)', () => {
    expect(mayHardDelete({ openingBalance: 0 })).toBe(true);
    expect(mayHardDelete({ openingBalance: 1 })).toBe(false);
    expect(mayHardDelete({ openingBalance: -2500 })).toBe(false);
  });

  it.each(['0599 123 456', '+970 (59) 123-4567', '٠٥٩٩١٢٣٤٥٦'])('accepts phone %p', (phone) => {
    expect(PHONE_PATTERN.test(phone)).toBe(true);
  });

  it.each(['call me', '059;DROP', 'abc123'])('rejects phone %p', (phone) => {
    expect(PHONE_PATTERN.test(phone)).toBe(false);
  });
});
