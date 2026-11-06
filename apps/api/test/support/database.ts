import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AppConfig, loadConfig } from '../../src/config/app-config';

/** Same major version as production (portable PostgreSQL 16). */
export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:16-alpine').start();
}

/** Real config validation, with a fresh random secret per run (no secrets in the repo). */
export function testConfig(databaseUrl: string, overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    LOG_LEVEL: 'silent',
    MIGRATE_ON_START: 'false',
    ...overrides,
  });
}
