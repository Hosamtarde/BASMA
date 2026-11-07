import { NetworkError } from './errors';

/**
 * The access token lives in memory only (never localStorage or a readable cookie), so a page
 * reload starts without one and restores the session from the httpOnly refresh cookie (ADR-0004).
 */
export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  mustChangePassword: boolean;
}

type Listener = () => void;

const REFRESH_URL = '/api/v1/auth/refresh';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<Listener>();
const expiredListeners = new Set<Listener>();

const notify = () => listeners.forEach((l) => l());

export const session = {
  token(): string | null {
    return accessToken;
  },

  isAuthenticated(): boolean {
    return accessToken !== null;
  },

  set(tokens: Pick<TokenPair, 'accessToken'>): void {
    accessToken = tokens.accessToken;
    notify();
  },

  /** Local sign-out (the server side is ended by POST /auth/logout or by expiry). */
  clear(): void {
    if (accessToken === null) return;
    accessToken = null;
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Called when a signed-in session ends on its own (refresh refused), not on a user sign-out. */
  onExpired(listener: Listener): () => void {
    expiredListeners.add(listener);
    return () => expiredListeners.delete(listener);
  },

  /**
   * Single flight: however many requests hit 401 at once, one POST /auth/refresh runs and they
   * all wait for it (a second, parallel refresh would replay a rotated token and end the whole
   * session family). Resolves true with a new access token, false when the cookie is refused.
   * A network failure rejects with NetworkError and keeps the current state.
   */
  refresh(language: string): Promise<boolean> {
    refreshing ??= runRefresh(language).finally(() => {
      refreshing = null;
    });
    return refreshing;
  },
};

async function runRefresh(language: string): Promise<boolean> {
  let response: Response;
  try {
    response = await globalThis.fetch(
      new Request(new URL(REFRESH_URL, globalThis.location.origin), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept-Language': language },
      }),
    );
  } catch (err) {
    throw new NetworkError(err);
  }
  if (response.ok) {
    const body = (await response.json()) as TokenPair;
    session.set(body);
    return true;
  }
  const wasSignedIn = accessToken !== null;
  session.clear();
  if (wasSignedIn) expiredListeners.forEach((l) => l());
  return false;
}

/** Tests only. */
export function resetSessionForTests(): void {
  accessToken = null;
  refreshing = null;
  listeners.clear();
  expiredListeners.clear();
}
