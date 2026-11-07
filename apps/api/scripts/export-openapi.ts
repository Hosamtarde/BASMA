/**
 * Writes apps/api/openapi.json (the contract the web client is generated from) without a
 * database: the pg pool connects lazily and nothing here runs a query.
 * Usage: npm run openapi:export -w apps/api
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.factory';
import { loadConfig } from '../src/config/app-config';
import { buildOpenApiDocument } from '../src/openapi';

async function main(): Promise<void> {
  const config = loadConfig({
    NODE_ENV: 'development',
    // Never connected to: only satisfies config validation.
    DATABASE_URL: 'postgres://openapi:unused@127.0.0.1:1/openapi',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    MIGRATE_ON_START: 'false',
    LOG_LEVEL: 'silent',
  });
  const app = await createApp(config);
  try {
    const out = path.resolve(__dirname, '..', 'openapi.json');
    writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
    process.stdout.write(`OpenAPI written to ${out}\n`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
