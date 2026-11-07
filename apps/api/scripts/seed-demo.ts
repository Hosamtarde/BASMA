/**
 * Development only: fills an EMPTY demo database with fictional sample data for demos and visual
 * checks. Never part of the production build or the installer.
 *
 *   DEMO_DATABASE_URL=postgres://user:pass@127.0.0.1:54329/lab_demo \
 *   DEMO_OWNER_PASSWORD=<at least 10 characters> npm run seed:demo -w apps/api
 *
 * - The database name must end with _e2e or _demo and be on this computer (scripts/demo/guard.ts).
 * - A missing database is created and migrated, then the API starts in this process on a free
 *   loopback port; all data goes through the real HTTP endpoints (rules, prices, snapshots,
 *   numbers, audit).
 * - No owner yet: first-run setup creates "owner" with DEMO_OWNER_PASSWORD. An owner exists:
 *   signs in with DEMO_OWNER_USERNAME (default "owner") and DEMO_OWNER_PASSWORD.
 * - Refuses when doctors, work types, technicians or cases already exist.
 */
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createApp } from '../src/app.factory';
import { loadConfig } from '../src/config/app-config';
import { runMigrations } from '../src/shared/db/migrator';
import { DEMO_LAB, DEMO_OWNER_USERNAME } from './demo/data';
import { assertDemoDatabase } from './demo/guard';
import { seedDemo } from './demo/seed';

/** A missing demo database is created (its name already passed the guard). */
async function createIfMissing(databaseUrl: string, name: string): Promise<void> {
  const admin = new URL(databaseUrl);
  admin.pathname = '/postgres';
  const pool = new Pool({ connectionString: admin.toString(), max: 1 });
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) {
      await pool.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
      console.log(`Created the database "${name}".`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;
  const name = assertDemoDatabase(databaseUrl);
  const password = process.env.DEMO_OWNER_PASSWORD;
  if (!password)
    throw new Error('Set DEMO_OWNER_PASSWORD (the demo owner password, at least 10 characters).');
  const username = process.env.DEMO_OWNER_USERNAME ?? DEMO_OWNER_USERNAME;

  await createIfMissing(databaseUrl!, name);
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: databaseUrl,
    // Tokens live only for this run.
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    MIGRATE_ON_START: 'false',
    LOG_LEVEL: 'warn',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    WEB_DIST_DIR: undefined,
  });
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  try {
    await runMigrations(pool, config.migrationsDir);
  } finally {
    await pool.end();
  }

  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const status = (await (await fetch(`${baseUrl}/api/v1/setup/status`)).json()) as {
      setupRequired: boolean;
    };
    if (status.setupRequired) {
      const res = await fetch(`${baseUrl}/api/v1/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          lab: { nameAr: DEMO_LAB.nameAr, nameEn: DEMO_LAB.nameEn, phone: DEMO_LAB.phone },
          currency: { code: 'ILS', symbol: '₪', decimals: 2 },
          language: 'ar',
        }),
      });
      if (res.status !== 201)
        throw new Error(`first-run setup failed: HTTP ${res.status} ${await res.text()}`);
      console.log(`Created the owner "${username}" (first-run setup).`);
    }
    console.log(`Seeding demo data into "${name}"…`);
    const report = await seedDemo({ baseUrl, username, password, log: (l) => console.log(`  ${l}`) });
    console.log(`Done: ${JSON.stringify(report)}`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
