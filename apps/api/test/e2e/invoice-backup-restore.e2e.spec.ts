import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApp } from '../../src/app.factory';
import { canonicalJson } from '../../src/modules/payments/domain/payment-rules';
import { OWNER_PASSWORD, startTestApp, TestApp } from '../support/app';
import { testConfig } from '../support/database';

jest.setTimeout(300_000);

interface Row {
  id: string;
  no: string;
  status: string;
  snapshot: unknown;
  snapshot_sha256: string;
  logo_sha256: string | null;
}

/**
 * Condition 1 of the B6 approval: the immutability triggers (no UPDATE / DELETE of issued invoices) must not
 * break backup and restore (SPEC §2.1, B7). A database with issued, voided and numbered invoices (start number
 * chosen by the owner, a frozen logo) is dumped with pg_dump in both formats the installer may use (custom and
 * plain SQL), restored into fresh empty databases, and checked: every row, snapshot and SHA-256 is identical, the
 * hash still verifies, the triggers are still active, and the API on the restored database serves the invoices
 * and continues the numbering without a gap.
 */
describe('Invoices survive pg_dump and restore (e2e)', () => {
  let t: TestApp;
  const api = (p: string) => `/api/v1${p}`;
  const issue = (body: object) =>
    request(t.http).post(api('/invoices')).set('Authorization', t.auth).set('Idempotency-Key', randomUUID()).send(body).expect(201);

  const rowsOf = async (pool: Pool) =>
    (
      await pool.query<Row>(
        'SELECT id::text, no::text, status, snapshot, snapshot_sha256, logo_sha256 FROM invoices ORDER BY id',
      )
    ).rows;

  const sh = async (cmd: string[]) => {
    const r = await t.container.exec(cmd);
    if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed (${r.exitCode}): ${r.output}`);
    return r.output;
  };

  beforeAll(async () => {
    t = await startTestApp();
    await request(t.http).patch(api('/settings/numbering')).set('Authorization', t.auth).send({ invoiceNoStart: 700 }).expect(200);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]);
    await request(t.http)
      .put(api('/settings/logo'))
      .set('Authorization', t.auth)
      .attach('file', png, { filename: 'l.png', contentType: 'image/png' })
      .expect(200);
    const wt = (await request(t.http).post(api('/work-types')).set('Authorization', t.auth).send({ name: 'Crown', unitPrice: 20_000 }).expect(201))
      .body.id as number;
    const doctorId = (await request(t.http).post(api('/doctors')).set('Authorization', t.auth).send({ name: 'Dr Backup' }).expect(201)).body
      .id as number;
    const c = await request(t.http)
      .post(api('/cases'))
      .set('Authorization', t.auth)
      .send({ doctorId, patientName: 'مريض النسخة', expectedDate: '2099-01-01', status: 'ready', lines: [{ toothNo: 11, workTypeId: wt }] })
      .expect(201);
    const cases = await issue({ type: 'cases', doctorId, caseIds: [c.body.id], expectedTotal: 20_000 });
    await issue({ type: 'statement', doctorId });
    const voided = await issue({ type: 'free', partyName: 'عميل', reason: 'سبب', amount: 500 });
    await request(t.http)
      .post(api(`/invoices/${voided.body.id}/void`))
      .set('Authorization', t.auth)
      .send({ rowVersion: voided.body.rowVersion, reason: 'خطأ' })
      .expect(200);
    await request(t.http)
      .post(api(`/invoices/${cases.body.id}/void`))
      .set('Authorization', t.auth)
      .send({ rowVersion: cases.body.rowVersion, reason: 'إعادة' })
      .expect(200);
    await issue({ type: 'cases', doctorId, caseIds: [c.body.id], expectedTotal: 20_000 });
  });
  afterAll(async () => {
    await t?.close();
  });

  it.each([
    ['custom format (pg_restore)', 'custom'],
    ['plain SQL (psql)', 'plain'],
  ])('%s: rows, snapshots and hashes are intact and the numbering continues', async (_label, format) => {
    const user = t.container.getUsername();
    const source = t.container.getDatabase();
    const target = `restored_${format}`;
    const file = `/tmp/backup_${format}`;
    if (format === 'custom') {
      await sh(['pg_dump', '-U', user, '-d', source, '-Fc', '-f', file]);
      await sh(['createdb', '-U', user, target]);
      await sh(['pg_restore', '-U', user, '-d', target, '--exit-on-error', file]);
    } else {
      await sh(['pg_dump', '-U', user, '-d', source, '-f', file]);
      await sh(['createdb', '-U', user, target]);
      await sh(['psql', '-U', user, '-d', target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file]);
    }

    const restoredUri = t.container.getConnectionUri().replace(new RegExp(`/${source}$`), `/${target}`);
    const restored = new Pool({ connectionString: restoredUri });
    try {
      const original = await rowsOf(t.pool);
      const copy = await rowsOf(restored);
      expect(original.length).toBe(4);
      expect(copy).toEqual(original);
      for (const r of copy) {
        expect(createHash('sha256').update(canonicalJson(r.snapshot)).digest('hex')).toBe(r.snapshot_sha256);
      }
      expect(copy.map((r) => [Number(r.no), r.status])).toEqual([
        [700, 'void'],
        [701, 'active'],
        [702, 'void'],
        [703, 'active'],
      ]);
      const counts = async (pool: Pool) =>
        (
          await pool.query(`SELECT (SELECT count(*) FROM invoice_cases)::int AS ic,
                                   (SELECT count(*) FROM invoice_cases WHERE active)::int AS active,
                                   (SELECT count(*) FROM document_images)::int AS images,
                                   (SELECT next_value FROM counters WHERE name = 'invoice_no')::int AS next`)
        ).rows[0] as Record<string, number>;
      expect(await counts(restored)).toEqual(await counts(t.pool));
      // The guards came back with the schema.
      await expect(restored.query(`UPDATE invoices SET snapshot = '{}'::jsonb`)).rejects.toThrow(/immutable/);
      await expect(restored.query(`DELETE FROM invoices`)).rejects.toThrow(/immutable/);

      // The API on the restored database verifies every hash on read and continues the numbering.
      const app: INestApplication = await createApp(testConfig(restoredUri, { AUTH_RATE_LIMIT_PER_MINUTE: '1000' }), {});
      await app.init();
      try {
        const http = app.getHttpServer() as App;
        const login = await request(http).post(api('/auth/login')).send({ username: 'owner', password: OWNER_PASSWORD }).expect(200);
        const auth = `Bearer ${login.body.accessToken as string}`;
        for (const r of copy) {
          const got = await request(http).get(api(`/invoices/${r.id}`)).set('Authorization', auth).expect(200);
          expect(got.body.snapshotSha256).toBe(r.snapshot_sha256);
        }
        const logo = await request(http).get(api(`/invoices/${copy[3]!.id}/logo`)).set('Authorization', auth).buffer(true).expect(200);
        expect(createHash('sha256').update(logo.body as Buffer).digest('hex')).toBe(copy[3]!.logo_sha256);
        const next = await request(http)
          .post(api('/invoices'))
          .set('Authorization', auth)
          .set('Idempotency-Key', randomUUID())
          .send({ type: 'free', partyName: 'بعد الاسترجاع', reason: 'x', amount: 100 })
          .expect(201);
        expect(next.body.no).toBe(704);
      } finally {
        await app.close();
      }
    } finally {
      await restored.end();
    }
  });
});
