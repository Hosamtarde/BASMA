// Development only, one command for demos and visual checks: `npm run demo` (repo root) builds
// everything, then starts the built API + UI on http://127.0.0.1:4330 with a fresh database full
// of fictional demo data. Sign in as "owner" with DEMO_OWNER_PASSWORD.
//
// Reads the repo .env: DATABASE_URL gives the server and credentials; the database used is
// "<name>_showcase_e2e" (reset on every start — never the database in DATABASE_URL itself; the
// E2E "demo" project uses <name>_demo_e2e, so both can run side by side).
// DEMO_OWNER_PASSWORD (at least 10 characters) must be set in .env or the environment.
const path = require('node:path');

try {
  process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch {
  // No .env: the environment must provide the values.
}

const base = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
const password = process.env.DEMO_OWNER_PASSWORD;
if (!base || !password) {
  process.stderr.write('Set DATABASE_URL (or DEMO_DATABASE_URL) and DEMO_OWNER_PASSWORD in .env first.\n');
  process.exit(1);
}
const url = new URL(base);
const name = decodeURIComponent(url.pathname.slice(1)).replace(/_(e2e|demo|dev)$/, '');
url.pathname = `/${name}_showcase_e2e`;

process.env.E2E_DATABASE_URL = url.toString();
process.env.E2E_SEED_OWNER_PASSWORD = password;
process.env.E2E_SEED_DEMO = '1';
process.env.E2E_PORT = process.env.DEMO_PORT ?? '4330';
require('./serve-e2e.cjs');
