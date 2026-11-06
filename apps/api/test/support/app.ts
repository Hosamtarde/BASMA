import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApp } from '../../src/app.factory';
import { AppConfig } from '../../src/config/app-config';
import { runMigrations } from '../../src/shared/db/migrator';
import { startPostgres, testConfig } from './database';

export const OWNER_PASSWORD = 'owner-password-1';

export interface TestApp {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  config: AppConfig;
  app: INestApplication;
  http: App;
  /** Bearer header of the owner (all permissions). */
  auth: string;
  /** Bearer header of a valid token that only has `account.self` (for 403 checks). */
  limitedAuth: string;
  close(): Promise<void>;
}

/** Minimal valid first-run body; tests override parts of it. */
export function setupBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    username: 'owner',
    password: OWNER_PASSWORD,
    ...overrides,
  };
}

/** Fresh PostgreSQL + migrated schema + running app + owner logged in. */
export async function startTestApp(env: NodeJS.ProcessEnv = {}): Promise<TestApp> {
  const container = await startPostgres();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const config = testConfig(container.getConnectionUri(), { AUTH_RATE_LIMIT_PER_MINUTE: '1000', ...env });
  await runMigrations(pool, config.migrationsDir);
  const app = await createApp(config);
  await app.init();
  const http = app.getHttpServer() as App;

  await request(http).post('/api/v1/setup').send(setupBody()).expect(201);
  const login = await request(http)
    .post('/api/v1/auth/login')
    .send({ username: 'owner', password: OWNER_PASSWORD })
    .expect(200);
  const me = await request(http)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${login.body.accessToken as string}`)
    .expect(200);

  const limited = await new JwtService({ secret: config.jwt.accessSecret }).signAsync(
    { sub: String(me.body.id as number), perms: ['account.self'] },
    { algorithm: 'HS256', expiresIn: 600 },
  );

  return {
    container,
    pool,
    config,
    app,
    http,
    auth: `Bearer ${login.body.accessToken as string}`,
    limitedAuth: `Bearer ${limited}`,
    async close() {
      await app.close();
      await pool.end();
      await container.stop();
    },
  };
}

/** Marks a row as "used" by referencing it from a scratch table with a RESTRICT foreign key. */
export async function markUsed(pool: Pool, table: string, id: number): Promise<void> {
  const usage = `test_usage_${table}`;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${usage} (ref_id bigint NOT NULL REFERENCES ${table}(id) ON DELETE RESTRICT)`,
  );
  await pool.query(`INSERT INTO ${usage} (ref_id) VALUES ($1)`, [id]);
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A request with the method chosen at runtime (for route tables). */
export function requestFor(http: App, method: HttpMethod, path: string): request.Test {
  const agent = request(http);
  const byMethod = {
    get: agent.get.bind(agent),
    post: agent.post.bind(agent),
    put: agent.put.bind(agent),
    patch: agent.patch.bind(agent),
    delete: agent.delete.bind(agent),
  };
  return byMethod[method](path);
}

/** Pairs of statuses, sorted, from concurrent requests. */
export const statusesOf = (responses: { status: number }[]): number[] =>
  responses.map((r) => r.status).sort((a, b) => a - b);
