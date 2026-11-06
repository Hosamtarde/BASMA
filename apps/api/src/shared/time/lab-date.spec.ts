import { dateInTimeZone, isCalendarDate } from './lab-date';

describe('dateInTimeZone', () => {
  it('switches day exactly at local midnight, not at UTC midnight (Hebron, winter UTC+2)', () => {
    expect(dateInTimeZone(new Date('2026-11-10T21:59:59Z'), 'Asia/Hebron')).toBe('2026-11-10');
    expect(dateInTimeZone(new Date('2026-11-10T22:00:00Z'), 'Asia/Hebron')).toBe('2026-11-11');
    // At 22:30 UTC the server's UTC date is still the 10th; the lab is already on the 11th.
    expect(dateInTimeZone(new Date('2026-11-10T22:30:00Z'), 'UTC')).toBe('2026-11-10');
    expect(dateInTimeZone(new Date('2026-11-10T22:30:00Z'), 'Asia/Hebron')).toBe('2026-11-11');
  });

  it('follows daylight saving time (Hebron, summer UTC+3)', () => {
    expect(dateInTimeZone(new Date('2026-07-01T20:59:59Z'), 'Asia/Hebron')).toBe('2026-07-01');
    expect(dateInTimeZone(new Date('2026-07-01T21:00:00Z'), 'Asia/Hebron')).toBe('2026-07-02');
  });

  it('handles zones behind UTC and year boundaries', () => {
    expect(dateInTimeZone(new Date('2027-01-01T03:00:00Z'), 'America/New_York')).toBe('2026-12-31');
  });
});

describe('isCalendarDate', () => {
  it.each(['2026-11-10', '2028-02-29'])('accepts %p', (v) => expect(isCalendarDate(v)).toBe(true));
  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '26-11-10', '2026-11-10T00:00', ''])('rejects %p', (v) =>
    expect(isCalendarDate(v)).toBe(false),
  );
});
