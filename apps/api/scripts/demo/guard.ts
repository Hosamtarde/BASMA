/**
 * Safety guard of the demo seed (development only). Demo data may only go into a throw-away
 * database: its name must end with `_e2e` or `_demo`, and it must be on this computer.
 * Anything else — above all a real lab database — is refused before a single request is made.
 */
const DEMO_SUFFIX = /_(e2e|demo)$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class DemoGuardError extends Error {}

/** Returns the database name when demo data may be written there; throws otherwise. */
export function assertDemoDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new DemoGuardError('No database given: set DEMO_DATABASE_URL (or DATABASE_URL).');
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new DemoGuardError('The database address is not a valid postgres:// URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DemoGuardError('The database address must start with postgres://.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!DEMO_SUFFIX.test(name)) {
    throw new DemoGuardError(
      `Refusing to write demo data into "${name || '(none)'}": the database name must end with _e2e or _demo.`,
    );
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new DemoGuardError(
      `Refusing to write demo data on "${url.hostname}": only a local database is allowed.`,
    );
  }
  return name;
}
