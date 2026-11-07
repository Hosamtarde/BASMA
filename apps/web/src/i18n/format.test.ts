import { describe, expect, it } from 'vitest';
import { formatDateTimeIn, todayIn } from './format';

describe('lab time zone formatting', () => {
  it('formats a timestamp in the lab time zone, 24-hour, Western digits', () => {
    // 21:30 UTC on 7 Nov is already 8 Nov in Hebron (UTC+2 in winter).
    expect(formatDateTimeIn('2026-11-07T21:30:00Z', 'Asia/Hebron')).toBe('2026-11-07 23:30');
    expect(formatDateTimeIn('2026-11-07T22:05:00Z', 'Asia/Hebron')).toBe('2026-11-08 00:05');
    expect(formatDateTimeIn('2026-11-07T22:05:00Z', 'UTC')).toBe('2026-11-07 22:05');
  });

  it("gives the lab's today, not the browser's", () => {
    const now = new Date('2026-11-07T22:30:00Z');
    expect(todayIn('Asia/Hebron', now)).toBe('2026-11-08');
    expect(todayIn('UTC', now)).toBe('2026-11-07');
  });
});
