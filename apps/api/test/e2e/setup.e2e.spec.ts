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

/** One container; each scenario gets its own fresh database inside it. */
describe('First-run setup in one step (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  const opened: { app: INestApplication; pool: Pool }[] = [];
  let dbCounter = 0;

  async function freshInstall(env: NodeJS.ProcessEnv = {}) {
    const admin = new Pool({ connectionString: container.getConnectionUri() });
    const name = `install_${++dbCounter}`;
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString() });
    const config = testConfig(url.toString(), { AUTH_RATE_LIMIT_PER_MINUTE: '1000', ...env });
    await runMigrations(pool, config.migrationsDir);
    const app = await createApp(config);
    await app.init();
    opened.push({ app, pool });
    return { http: app.getHttpServer() as App, pool };
  }

  const categories = async (pool: Pool) =>
    (
      await pool.query<{ name: string; is_doctor: boolean }>(
        `SELECT name, is_doctor FROM expense_categories ORDER BY id`,
      )
    ).rows;

  beforeAll(async () => {
    container = await startPostgres();
  });

  afterAll(async () => {
    for (const { app, pool } of opened) {
      await app.close();
      await pool.end();
    }
    await container?.stop();
  });

  it('Arabic setup: owner, settings and Arabic expense categories; no work types, no prices', async () => {
    const { http, pool } = await freshInstall({ DEFAULT_TIME_ZONE: 'Asia/Hebron' });
    const res = await request(http)
      .post('/api/v1/setup')
      .send(setupBody({ lab: { nameAr: ' مختبر سمايل ', phone: '02 222 3333', address: 'الخليل' } }))
      .expect(201);
    expect(res.body).toEqual({ id: expect.any(Number), username: 'owner' });

    expect(await categories(pool)).toEqual([
      { name: 'طبيب (استرداد)', is_doctor: true },
      { name: 'إيجار', is_doctor: false },
      { name: 'كهرباء', is_doctor: false },
      { name: 'ماء', is_doctor: false },
      { name: 'مواد', is_doctor: false },
      { name: 'رواتب', is_doctor: false },
      { name: 'مواصلات', is_doctor: false },
      { name: 'أخرى', is_doctor: false },
    ]);
    const counts = await pool.query<{ work_types: string; prices: string }>(
      `SELECT (SELECT count(*) FROM work_types) AS work_types, (SELECT count(*) FROM doctor_prices) AS prices`,
    );
    expect(counts.rows[0]).toEqual({ work_types: '0', prices: '0' });

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ username: 'owner', password: setupBody().password })
      .expect(200);
    const settings = await request(http)
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .expect(200);
    expect(settings.body).toMatchObject({
      labProfile: {
        nameAr: 'مختبر سمايل',
        nameEn: null,
        phone: '02 222 3333',
        address: 'الخليل',
        timeZone: 'Asia/Hebron', // from DEFAULT_TIME_ZONE
        rowVersion: 1,
      },
      currency: { code: 'ILS', symbol: '₪', decimals: 2, locked: { code: false, decimals: false } },
      language: { ui: 'ar', documents: 'ar' },
      logo: { present: false },
    });
  });

  it('English setup names the categories in English and uses the requested time zone', async () => {
    const { http, pool } = await freshInstall();
    await request(http)
      .post('/api/v1/setup')
      .send(
        setupBody({
          lab: { nameEn: 'Smile Lab', phone: '+970 59 000 0000' },
          currency: { code: 'JOD', symbol: 'JD', decimals: 3 },
          language: 'en',
          timeZone: 'Asia/Amman',
        }),
      )
      .expect(201);
    expect((await categories(pool)).map((c) => c.name)).toEqual([
      'Doctor (refund)',
      'Rent',
      'Electricity',
      'Water',
      'Materials',
      'Salaries',
      'Transport',
      'Other',
    ]);
    const { rows } = await pool.query<{ key: string; value: Record<string, unknown> }>(
      `SELECT key, value FROM settings ORDER BY key`,
    );
    expect(rows).toEqual([
      { key: 'currency', value: { code: 'JOD', symbol: 'JD', decimals: 3 } },
      {
        key: 'lab_profile',
        value: {
          nameAr: null,
          nameEn: 'Smile Lab',
          phone: '+970 59 000 0000',
          address: null,
          slogan: null,
          timeZone: 'Asia/Amman',
        },
      },
      { key: 'language', value: { ui: 'en', documents: 'en' } },
    ]);
  });

  describe('validation (nothing is created)', () => {
    let http: App;
    let pool: Pool;

    beforeAll(async () => {
      ({ http, pool } = await freshInstall());
    });

    afterEach(async () => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM settings)
              + (SELECT count(*) FROM expense_categories) AS n`,
      );
      expect(rows[0]?.n).toBe('0');
    });

    it('requires a lab name in at least one language', async () => {
      const res = await request(http)
        .post('/api/v1/setup')
        .send(setupBody({ lab: { nameAr: '  ', phone: '022' } }))
        .expect(400);
      expect(res.body.error.code).toBe('error.settings.lab_name_required');
    });

    it.each([
      ['missing phone', { lab: { nameAr: 'مختبر' } }, 'lab.phone'],
      ['bad phone', { lab: { nameAr: 'مختبر', phone: 'call me' } }, 'lab.phone'],
      ['unknown lab field', { lab: { nameAr: 'مختبر', phone: '022', logo: 'x' } }, 'lab.logo'],
      ['decimals out of range', { currency: { code: 'ILS', symbol: '₪', decimals: 4 } }, 'currency.decimals'],
      ['missing currency code', { currency: { symbol: '₪', decimals: 2 } }, 'currency.code'],
      ['unsupported language', { language: 'fr' }, 'language'],
      ['unknown time zone', { timeZone: 'Hebron' }, 'timeZone'],
      ['null time zone', { timeZone: null }, 'timeZone'],
    ])('rejects %s', async (_label, override, field) => {
      const res = await request(http).post('/api/v1/setup').send(setupBody(override)).expect(400);
      const fields = (res.body.error.details.fields as { field: string }[]).map((f) => f.field);
      expect(fields).toContain(field);
    });
  });

  it('is all-or-nothing: a failure while seeding rolls back the owner and the settings', async () => {
    const { http, pool } = await freshInstall();
    // A conflicting row makes the category seed fail inside the setup transaction.
    await pool.query(`INSERT INTO expense_categories (name) VALUES ('مواد')`);
    await request(http).post('/api/v1/setup').send(setupBody()).expect(500);

    const { rows } = await pool.query<{ users: string; settings: string }>(
      `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM settings) AS settings`,
    );
    expect(rows[0]).toEqual({ users: '0', settings: '0' });

    await pool.query(`DELETE FROM expense_categories`);
    await request(http).post('/api/v1/setup').send(setupBody()).expect(201);
  });
});
