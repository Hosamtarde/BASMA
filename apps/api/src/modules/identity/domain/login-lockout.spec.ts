import { afterFailedLogin, isLocked, LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES } from './login-lockout';

describe('login lockout', () => {
  const now = new Date('2026-11-06T10:00:00Z');

  it('counts failures below the limit without locking', () => {
    const next = afterFailedLogin({ failedLogins: 0, lockedUntil: null }, now);
    expect(next).toEqual({ failedLogins: 1, lockedUntil: null, justLocked: false });
  });

  it(`locks for ${LOGIN_LOCK_MINUTES} minutes on failure #${LOGIN_MAX_FAILURES} and resets the counter`, () => {
    const next = afterFailedLogin({ failedLogins: LOGIN_MAX_FAILURES - 1, lockedUntil: null }, now);
    expect(next.justLocked).toBe(true);
    expect(next.failedLogins).toBe(0);
    expect(next.lockedUntil?.getTime()).toBe(now.getTime() + LOGIN_LOCK_MINUTES * 60_000);
  });

  it('is locked strictly before lockedUntil and unlocked from then on', () => {
    const lockedUntil = new Date(now.getTime() + 1000);
    expect(isLocked({ failedLogins: 0, lockedUntil }, now)).toBe(true);
    expect(isLocked({ failedLogins: 0, lockedUntil }, lockedUntil)).toBe(false);
    expect(isLocked({ failedLogins: 0, lockedUntil: null }, now)).toBe(false);
  });
});
