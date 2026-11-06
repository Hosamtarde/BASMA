/** SPEC §12-style default, easy to change: 5 wrong passwords lock the account for 15 minutes. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

export interface LoginState {
  failedLogins: number;
  lockedUntil: Date | null;
}

export function isLocked(state: LoginState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** New state after a wrong password. Reaching the limit locks the account and resets the counter. */
export function afterFailedLogin(state: LoginState, now: Date): LoginState & { justLocked: boolean } {
  const failedLogins = state.failedLogins + 1;
  if (failedLogins >= LOGIN_MAX_FAILURES) {
    return {
      failedLogins: 0,
      lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000),
      justLocked: true,
    };
  }
  return { failedLogins, lockedUntil: state.lockedUntil, justLocked: false };
}
