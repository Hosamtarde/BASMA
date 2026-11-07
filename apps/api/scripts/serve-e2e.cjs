// Web E2E only (Playwright webServer): creates (if missing) and resets a database whose name ends
// with "_e2e", migrates it and serves the built API and the built UI on one loopback origin, like
// the installed product (ADR-0017). With E2E_SEED_OWNER_PASSWORD it also completes first-run setup
// through the real endpoint, so test files start signed-out with an owner. Needs `npm run build`.
// Never point it at a real lab database.
//
//   E2E_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/lab_e2e node apps/api/scripts/serve-e2e.cjs
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const { createApp } = require('../dist/app.factory');
const { loadConfig } = require('../dist/config/app-config');
const { runMigrations } = require('../dist/shared/db/migrator');

async function createIfMissing(url, name) {
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const pool = new Pool({ connectionString: admin.toString(), max: 1 });
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) await pool.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  } finally {
    await pool.end();
  }
}

async function resetDatabase(url) {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/_e2e$/.test(name)) throw new Error(`refusing to reset "${name}": E2E databases must end with _e2e`);
  await createIfMissing(url, name);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'",
    );
    for (const { nspname } of rows) await pool.query(`DROP SCHEMA "${nspname.replaceAll('"', '""')}" CASCADE`);
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
}

async function main() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('E2E_DATABASE_URL is required');
  await resetDatabase(url);

  const config = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: url,
    // A fresh random secret per run; nothing secret is stored.
    JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('base64url'),
    API_PORT: process.env.E2E_PORT ?? '4320',
    WEB_DIST_DIR: path.resolve(__dirname, '../../web/dist'),
    MIGRATE_ON_START: 'false',
    LOG_LEVEL: 'warn',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    DEFAULT_TIME_ZONE: 'Asia/Hebron',
  });
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await runMigrations(pool, config.migrationsDir);
  } finally {
    await pool.end();
  }
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  const ownerPassword = process.env.E2E_SEED_OWNER_PASSWORD;
  if (ownerPassword) {
    const res = await fetch(`http://${config.host}:${config.port}/api/v1/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner',
        password: ownerPassword,
        lab: { nameAr: 'مختبر التجارب', nameEn: 'Test Lab', phone: '02 222 3333' },
        currency: { code: 'ILS', symbol: '₪', decimals: 2 },
        language: 'ar',
        timeZone: 'Asia/Hebron',
      }),
    });
    if (res.status !== 201) throw new Error(`seeding the owner failed: HTTP ${res.status}`);
  }
  process.stdout.write(`E2E API + UI on http://${config.host}:${config.port}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
