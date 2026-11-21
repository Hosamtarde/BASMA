import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DatabaseError, Pool } from 'pg';
import { getMigrationStatus, runMigrations } from '../../src/shared/db/migrator';
import { startPostgres, testConfig } from '../support/database';
import { migrationsUpTo } from '../support/migrations';

jest.setTimeout(180_000);

async function pgError(promise: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string } | undefined> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DatabaseError) return { code: e.code, constraint: e.constraint, message: e.message };
    throw e;
  }
  return undefined;
}

const SHA = 'a'.repeat(64);

/**
 * B6 migration 0009 (docs/plans/b6-invoices.md §2): `invoices`, `invoice_cases`, `document_images`, their CHECKs,
 * the partial unique index "one active invoice per case", the immutability triggers and the invoice permissions.
 * Expand-only: an 0008 database with data upgrades untouched.
 */
describe('B6 migration 0009 — invoices (PostgreSQL 16)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let migrationsDir: string;
  let doctorId: number;
  let caseId: number;

  const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
    const cols = Object.keys(row);
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return Number(res.rows[0]?.id);
  };
  let no = 0;
  const invoice = (fields: Record<string, unknown> = {}) =>
    insert('invoices', {
      no: ++no,
      type: 'free',
      party_name: 'Party',
      issue_date: '2026-11-20',
      language: 'ar',
      currency_code: 'ILS',
      subtotal: 100,
      discount: 0,
      total: 100,
      snapshot: '{}',
      snapshot_version: 1,
      snapshot_sha256: SHA,
      ...fields,
    });

  beforeAll(async () => {
    container = await startPostgres();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    migrationsDir = testConfig(container.getConnectionUri()).migrationsDir;
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('upgrades 0008 with data: rows untouched, every constraint valid, migrations current', async () => {
    await runMigrations(pool, migrationsUpTo(migrationsDir, 9));
    doctorId = await insert('doctors', { name: 'Dr Keep', opening_balance: 0 });
    caseId = await insert('cases', {
      case_no: 1,
      doctor_id: doctorId,
      patient_name: 'P',
      received_date: '2026-11-01',
      expected_date: '2026-11-05',
      status: 'ready',
    });
    const before = await pool.query('SELECT * FROM cases ORDER BY id');
    await runMigrations(pool, migrationsDir);
    expect((await getMigrationStatus(pool, migrationsDir)).current).toBe(true);
    expect((await pool.query('SELECT * FROM cases ORDER BY id')).rows).toEqual(before.rows);
    expect((await pool.query(`SELECT conname FROM pg_constraint WHERE NOT convalidated`)).rows).toEqual([]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM invoices`)).rows[0]).toEqual({ n: 0 });
  });

  it('grants the three invoice permissions to the owner', async () => {
    const codes = await pool.query<{ code: string }>(
      `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'owner' AND rp.permission_code LIKE 'invoices.%' ORDER BY 1`,
    );
    expect(codes.rows.map((r) => r.code)).toEqual(['invoices.read', 'invoices.void', 'invoices.write']);
  });

  describe('constraints', () => {
    it.each([
      ['a free invoice of 0', { total: 0, subtotal: 0 }, 'invoices_money_ck'],
      ['a cases invoice without its doctor', { type: 'cases' }, 'invoices_party_ck'],
      ['a free invoice with a discount', { discount: 10, total: 90 }, 'invoices_money_ck'],
      ['total ≠ subtotal − discount', { total: 99 }, 'invoices_money_ck'],
      ['an unknown type', { type: 'quote', doctor_id: 1 }, 'invoices_type_ck'],
      ['an unknown language', { language: 'fr' }, 'invoices_language_ck'],
      ['a bad hash', { snapshot_sha256: 'x' }, 'invoices_sha256_ck'],
      ['void without a reason', { status: 'void', voided_at: '2026-11-20T10:00:00Z' }, 'invoices_void_ck'],
      ['a key without a hash', { idempotency_key: '7d7c2c55-1c0f-4d1b-8c8f-2f2d9b4f5a11' }, 'invoices_idempotency_ck'],
      ['an empty party', { party_name: '' }, 'invoices_party_name_ck'],
    ])('refuses %s', async (_l, fields, constraint) => {
      const e = await pgError(invoice(fields));
      expect(e).toMatchObject({ code: '23514', constraint });
    });

    it('a statement has no amounts; a cases invoice needs its doctor', async () => {
      await invoice({ type: 'statement', doctor_id: doctorId, subtotal: null, discount: null, total: null });
      expect(await pgError(invoice({ type: 'statement', doctor_id: doctorId }))).toMatchObject({ constraint: 'invoices_money_ck' });
      expect(await pgError(invoice({ type: 'cases', doctor_id: null }))).toMatchObject({ constraint: 'invoices_party_ck' });
    });

    it('numbers are unique', async () => {
      await invoice({ no: 500 });
      expect(await pgError(invoice({ no: 500 }))).toMatchObject({ code: '23505', constraint: 'invoices_no_uq' });
    });
  });

  describe('one active invoice per case (plan P1)', () => {
    it('refuses a second active link, accepts one after the first is deactivated', async () => {
      const a = await invoice({ type: 'cases', doctor_id: doctorId });
      const b = await invoice({ type: 'cases', doctor_id: doctorId });
      await pool.query('INSERT INTO invoice_cases (invoice_id, case_id) VALUES ($1, $2)', [a, caseId]);
      expect(await pgError(pool.query('INSERT INTO invoice_cases (invoice_id, case_id) VALUES ($1, $2)', [b, caseId]))).toMatchObject({
        code: '23505',
        constraint: 'invoice_cases_active_case_uq',
      });
      await pool.query(`UPDATE invoices SET status = 'void', void_reason = 'x', voided_at = now() WHERE id = $1`, [a]);
      await pool.query('UPDATE invoice_cases SET active = false WHERE invoice_id = $1', [a]);
      await pool.query('INSERT INTO invoice_cases (invoice_id, case_id) VALUES ($1, $2)', [b, caseId]);
    });
  });

  describe('immutability triggers', () => {
    it('only the void columns of an active invoice may change, once', async () => {
      const id = await invoice({ snapshot: '{"a":1}' });
      for (const set of [`snapshot = '{"a":2}'`, `total = 101, subtotal = 101`, `no = no + 999`, `party_name = 'Other'`, `issue_date = '2026-01-01'`, `snapshot_version = 2`, `created_at = now() - interval '1 day'`]) {
        const e = await pgError(pool.query(`UPDATE invoices SET ${set} WHERE id = $1`, [id]));
        expect({ set, message: e?.message }).toEqual({ set, message: expect.stringMatching(/immutable/) });
      }
      await pool.query(`UPDATE invoices SET status = 'void', void_reason = 'r', voided_at = now(), row_version = row_version + 1 WHERE id = $1`, [id]);
      expect((await pgError(pool.query(`UPDATE invoices SET void_reason = 'other' WHERE id = $1`, [id])))?.message).toMatch(/stays void/);
      expect((await pgError(pool.query(`UPDATE invoices SET status = 'active', void_reason = NULL, voided_at = NULL WHERE id = $1`, [id])))?.message).toMatch(
        /immutable/,
      );
    });

    it('nothing is ever deleted, even when no row matches', async () => {
      for (const table of ['invoices', 'invoice_cases', 'document_images']) {
        expect((await pgError(pool.query(`DELETE FROM ${table} WHERE false`)))?.message).toMatch(/immutable/);
      }
    });

    it('invoice_cases only moves from active to inactive; document_images never changes', async () => {
      const a = await invoice({ type: 'cases', doctor_id: doctorId });
      const c2 = await insert('cases', {
        case_no: 2,
        doctor_id: doctorId,
        patient_name: 'P2',
        received_date: '2026-11-01',
        expected_date: '2026-11-05',
        status: 'ready',
      });
      await pool.query('INSERT INTO invoice_cases (invoice_id, case_id) VALUES ($1, $2)', [a, c2]);
      expect((await pgError(pool.query('UPDATE invoice_cases SET case_id = $1 WHERE invoice_id = $2', [caseId, a])))?.message).toMatch(/immutable/);
      await pool.query('UPDATE invoice_cases SET active = false WHERE invoice_id = $1', [a]);
      expect((await pgError(pool.query('UPDATE invoice_cases SET active = true WHERE invoice_id = $1', [a])))?.message).toMatch(/immutable/);
      await pool.query(`INSERT INTO document_images (sha256, mime_type, size_bytes, content) VALUES ($1, 'image/png', 1, '\\x00')`, [SHA]);
      expect((await pgError(pool.query(`UPDATE document_images SET mime_type = 'image/jpeg'`)))?.message).toMatch(/immutable/);
    });
  });

  it('the list and the doctor filter use their indexes', async () => {
    await pool.query('SET enable_seqscan = off');
    try {
      const plan = async (q: string) => (await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${q}`)).rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(await plan('SELECT id FROM invoices ORDER BY issue_date DESC, id DESC LIMIT 25')).toContain('invoices_issue_date_ix');
      expect(await plan(`SELECT id FROM invoices WHERE doctor_id = 1 ORDER BY issue_date DESC LIMIT 25`)).toContain('invoices_doctor_ix');
      expect(await plan('SELECT case_id FROM invoice_cases WHERE active AND case_id = 1')).toMatch(/invoice_cases_(active_case_uq|case_ix)/);
    } finally {
      await pool.query('RESET enable_seqscan');
    }
  });
});
