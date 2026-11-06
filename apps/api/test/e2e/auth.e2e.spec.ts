import { INestApplication } from '@nestjs/common';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApp } from '../../src/app.factory';
import { runMigrations } from '../../src/shared/db/migrator';
import { setupBody } from '../support/app';
import { startPostgres, testConfig } from '../support/database';

jest.setTimeout(180_000);

const OWNER = { username: 'Owner', password: 'first-password-1' };
const NEW_PASSWORD = 'second-password-2';

describe('B0 API end to end', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: INestApplication;
  let http: App;

  const login = (username: string, password: string) =>
    request(http).post('/api/v1/auth/login').send({ username, password });

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    const config = testConfig(container.getConnectionUri(), { AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
    await runMigrations(pool, config.migrationsDir);
    app = await createApp(config);
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
  });

  describe('health, logging and errors', () => {
    it('live and ready report ok, with a generated correlation id', async () => {
      const live = await request(http).get('/api/v1/health/live').expect(200);
      expect(live.body).toEqual({ status: 'ok' });
      expect(live.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const ready = await request(http).get('/api/v1/health/ready').expect(200);
      expect(ready.body).toEqual({ status: 'ok', database: 'up', migrations: 'current' });
    });

    it('reuses a well-formed X-Request-Id and puts it in the error envelope', async () => {
      const res = await request(http)
        .get('/api/v1/no-such-route')
        .set('X-Request-Id', 'abc-12345678')
        .expect(404);
      expect(res.headers['x-request-id']).toBe('abc-12345678');
      expect(res.body).toEqual({
        error: {
          code: 'error.not_found',
          message: 'العنصر المطلوب غير موجود.',
          params: {},
          correlationId: 'abc-12345678',
        },
      });
    });

    it('serves the OpenAPI document outside production', async () => {
      const res = await request(http).get('/api/docs-json').expect(200);
      const paths = Object.keys((res.body as { paths: object }).paths);
      expect(paths).toEqual(
        expect.arrayContaining(['/api/v1/setup', '/api/v1/auth/login', '/api/v1/health/ready']),
      );
    });

    it('sets security headers (helmet)', async () => {
      const res = await request(http).get('/api/v1/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('first-run setup', () => {
    it('is required on an empty database', async () => {
      const res = await request(http).get('/api/v1/setup/status').expect(200);
      expect(res.body).toEqual({ setupRequired: true });
    });

    it('rejects invalid input and unknown fields, localized in ar (default) and en', async () => {
      const ar = await request(http)
        .post('/api/v1/setup')
        .send({ username: 'a b', password: 'short', role: 'admin' })
        .expect(400);
      expect(ar.body.error.code).toBe('error.validation.failed');
      expect(ar.body.error.message).toBe('بعض البيانات المدخلة غير صحيحة.');
      const fields = (ar.body.error.details.fields as { field: string }[]).map((f) => f.field).sort();
      expect(fields).toEqual(['currency', 'lab', 'language', 'password', 'role', 'username']);

      const en = await request(http)
        .post('/api/v1/setup')
        .set('Accept-Language', 'en-US,en;q=0.9')
        .send({})
        .expect(400);
      expect(en.body.error.message).toBe('Some of the entered data is not valid.');
    });

    it('creates exactly one owner even under concurrent requests, then locks itself', async () => {
      const results = await Promise.all([
        request(http).post('/api/v1/setup').send(setupBody(OWNER)),
        request(http)
          .post('/api/v1/setup')
          .send(setupBody({ username: 'intruder', password: 'intruder-pass-1' })),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const winner = results.find((r) => r.status === 201);
      // Keep the test deterministic: if the other request won, continue with that account.
      if (winner?.body.username !== OWNER.username) {
        OWNER.username = 'intruder';
        OWNER.password = 'intruder-pass-1';
      }
      const loser = results.find((r) => r.status === 409);
      expect(loser?.body.error.code).toBe('error.setup.already_done');

      await request(http)
        .post('/api/v1/setup')
        .send(setupBody({ username: 'late', password: 'late-password-1' }))
        .expect(409);
      const status = await request(http).get('/api/v1/setup/status').expect(200);
      expect(status.body).toEqual({ setupRequired: false });

      const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
      expect(rows[0]?.n).toBe('1');
      const audit = await pool.query<{ action: string }>(`SELECT action FROM audit_log`);
      expect(audit.rows).toEqual([{ action: 'setup.completed' }]);
    });

    it('stores only an Argon2id hash, never the password', async () => {
      const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users');
      expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0]?.password_hash).not.toContain(OWNER.password);
    });
  });

  describe('authentication', () => {
    it('rejects protected routes without a valid token', async () => {
      const none = await request(http).get('/api/v1/auth/me').expect(401);
      expect(none.body.error.code).toBe('error.auth.unauthenticated');
      await request(http).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('gives one generic error for unknown user and wrong password', async () => {
      const unknown = await login('nobody', 'whatever-pass').expect(401);
      const wrong = await login(OWNER.username, 'wrong-password').expect(401);
      expect(unknown.body.error.code).toBe('error.auth.invalid_credentials');
      expect(wrong.body.error.code).toBe('error.auth.invalid_credentials');
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('logs in (username is case-insensitive) and returns the profile', async () => {
      const res = await login(OWNER.username.toUpperCase(), OWNER.password).expect(200);
      expect(res.body).toEqual({
        accessToken: expect.any(String),
        accessTokenExpiresIn: 900,
        refreshToken: expect.any(String),
        refreshTokenExpiresAt: expect.any(String),
        mustChangePassword: false,
      });
      const me = await request(http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toEqual({
        id: expect.any(Number),
        username: OWNER.username,
        permissions: [
          'account.self',
          'catalog.read',
          'catalog.write',
          'doctors.read',
          'doctors.write',
          'settings.read',
          'settings.write',
        ],
        mustChangePassword: false,
      });
    });

    it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
      const first = await login(OWNER.username, OWNER.password).expect(200);
      const second = await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);
      expect(second.body.refreshToken).not.toBe(first.body.refreshToken);

      // Replay of the used token: rejected, and the newer token dies with it.
      const replay = await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
      expect(replay.body.error.code).toBe('error.auth.invalid_refresh_token');
      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.body.refreshToken })
        .expect(401);

      const { rows } = await pool.query(`SELECT 1 FROM audit_log WHERE action = 'auth.refresh_token_reuse'`);
      expect(rows).toHaveLength(1);
    });

    it('stores refresh tokens only as hashes', async () => {
      const res = await login(OWNER.username, OWNER.password).expect(200);
      const { rows } = await pool.query(`SELECT 1 FROM refresh_tokens WHERE token_hash = $1`, [
        res.body.refreshToken,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('logout ends the session', async () => {
      const res = await login(OWNER.username, OWNER.password).expect(200);
      await request(http)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .send({ refreshToken: res.body.refreshToken })
        .expect(204);
      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: res.body.refreshToken })
        .expect(401);

      // A retry with a logged-out token is not a replay attack: no extra reuse audit entry.
      const { rows } = await pool.query(`SELECT 1 FROM audit_log WHERE action = 'auth.refresh_token_reuse'`);
      expect(rows).toHaveLength(1);
    });

    it('changes the password, checks the current one and ends all sessions', async () => {
      const res = await login(OWNER.username, OWNER.password).expect(200);
      const auth = `Bearer ${res.body.accessToken}`;

      const wrong = await request(http)
        .post('/api/v1/auth/change-password')
        .set('Authorization', auth)
        .send({ currentPassword: 'not-the-password', newPassword: NEW_PASSWORD })
        .expect(400);
      expect(wrong.body.error.code).toBe('error.auth.wrong_current_password');

      await request(http)
        .post('/api/v1/auth/change-password')
        .set('Authorization', auth)
        .send({ currentPassword: OWNER.password, newPassword: NEW_PASSWORD })
        .expect(204);

      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: res.body.refreshToken })
        .expect(401);
      await login(OWNER.username, OWNER.password).expect(401);
      await login(OWNER.username, NEW_PASSWORD).expect(200);
      OWNER.password = NEW_PASSWORD;
    });

    it('locks the account for a while after 5 wrong passwords', async () => {
      for (let i = 0; i < 5; i++) await login(OWNER.username, 'wrong-password').expect(401);
      // Even the right password is refused while locked, with the same generic message.
      const locked = await login(OWNER.username, OWNER.password).expect(401);
      expect(locked.body.error.code).toBe('error.auth.invalid_credentials');

      const { rows } = await pool.query(`SELECT 1 FROM audit_log WHERE action = 'auth.account_locked'`);
      expect(rows).toHaveLength(1);

      // Simulate the lock period passing.
      await pool.query(`UPDATE users SET locked_until = now() - interval '1 second'`);
      await login(OWNER.username, OWNER.password).expect(200);
    });
  });

  describe('rate limiting', () => {
    let limited: INestApplication;

    afterAll(async () => {
      await limited?.close();
    });

    it('returns 429 with the catalog code after too many auth requests', async () => {
      limited = await createApp(
        testConfig(container.getConnectionUri(), { AUTH_RATE_LIMIT_PER_MINUTE: '3' }),
      );
      await limited.init();
      const server = limited.getHttpServer() as App;
      for (let i = 0; i < 3; i++) {
        await request(server).post('/api/v1/auth/login').send({ username: 'x', password: 'y' }).expect(401);
      }
      const res = await request(server)
        .post('/api/v1/auth/login')
        .set('Accept-Language', 'en')
        .send({ username: 'x', password: 'y' })
        .expect(429);
      expect(res.body.error.code).toBe('error.rate_limited');
      expect(res.body.error.message).toBe('Too many attempts. Wait a moment and try again.');
    });
  });
});
