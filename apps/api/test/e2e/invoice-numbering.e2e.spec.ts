import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { startTestApp, statusesOf, TestApp } from '../support/app';

jest.setTimeout(300_000);

/**
 * B6 numbering (SPEC §7.7, §12 owner answer 12; plan §2, condition 2 of the approval): invoice numbers start
 * at the number the owner chooses, which can be changed only before the first invoice; they are gap-free under
 * concurrent issuance, a void never frees a number, and a failed issue gives its number back.
 */
describe('Invoice numbering (e2e)', () => {
  let t: TestApp;
  const api = (p: string) => `/api/v1${p}`;
  const get = (p: string) => request(t.http).get(api(p)).set('Authorization', t.auth);
  const issue = (body: object, key: string = randomUUID()) =>
    request(t.http).post(api('/invoices')).set('Authorization', t.auth).set('Idempotency-Key', key).send(body);
  const free = (n: number | string) => ({ type: 'free', partyName: `Party ${n}`, reason: 'Numbering', amount: 100 });
  const numbers = async () =>
    (await t.pool.query<{ no: string }>('SELECT no FROM invoices ORDER BY no')).rows.map((r) => Number(r.no));

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('the start number is settable before the first invoice and refused after it', async () => {
    const s = (await get('/settings').expect(200)).body;
    expect(s.numbering.invoiceNo).toMatchObject({ locked: false });
    await request(t.http).patch(api('/settings/numbering')).set('Authorization', t.auth).send({ invoiceNoStart: 900 }).expect(200);
    await request(t.http).patch(api('/settings/numbering')).set('Authorization', t.auth).send({ invoiceNoStart: 5000 }).expect(200);
    const first = await issue(free('first')).expect(201);
    expect(first.body.no).toBe(5000);
    const after = (await get('/settings').expect(200)).body;
    expect(after.numbering.invoiceNo).toMatchObject({ startValue: 5000, locked: true });
    const refused = await request(t.http)
      .patch(api('/settings/numbering'))
      .set('Authorization', t.auth)
      .send({ invoiceNoStart: 1 })
      .expect(409);
    expect(refused.body.error.code).toBe('error.settings.numbering_locked');
    // The case counter is a different counter: the invoice did not lock it.
    expect(after.numbering.caseNo).toMatchObject({ locked: false });
  });

  it('concurrent issuance with voids in between stays gap-free; a void never frees its number', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => issue(free(i))));
    expect(statusesOf(results)).toEqual(Array(20).fill(201));
    const voided = results.slice(0, 5).map((r) => r.body as { id: number; rowVersion: number; no: number });
    // Voids racing new invoices.
    const mixed = await Promise.all([
      ...voided.map((v) =>
        request(t.http)
          .post(api(`/invoices/${v.id}/void`))
          .set('Authorization', t.auth)
          .send({ rowVersion: v.rowVersion, reason: 'race' }),
      ),
      ...Array.from({ length: 10 }, (_, i) => issue(free(`m${i}`))),
    ]);
    expect(statusesOf(mixed)).toEqual([...Array(5).fill(200), ...Array(10).fill(201)]);
    const all = await numbers();
    expect(all).toEqual(Array.from({ length: 31 }, (_, i) => 5000 + i));
    const next = await issue(free('next')).expect(201);
    expect(next.body.no).toBe(5031);
    // Voided numbers stay listed as void.
    for (const v of voided) {
      expect((await get(`/invoices/${v.id}`).expect(200)).body).toMatchObject({ no: v.no, status: 'void' });
    }
  });

  it('a failed issue after taking the number gives it back; a replayed key takes none', async () => {
    await t.pool.query(`
      CREATE FUNCTION test_fail_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.party_name = 'FAIL' THEN RAISE EXCEPTION 'forced failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_invoice BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION test_fail_invoice();`);
    try {
      const before = await numbers();
      await issue({ type: 'free', partyName: 'FAIL', reason: 'x', amount: 1 }).expect(500);
      expect(await numbers()).toEqual(before);
      const key = randomUUID();
      const ok = await issue(free('after failure'), key).expect(201);
      expect(ok.body.no).toBe((before.at(-1) ?? 0) + 1);
      const replay = await issue(free('after failure'), key).expect(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(ok.body.id);
      const raceKey = randomUUID();
      const twice = await Promise.all([issue(free('race key'), raceKey), issue(free('race key'), raceKey)]);
      expect(statusesOf(twice)).toEqual([200, 201]);
      expect(twice[0].body.no).toBe(twice[1].body.no);
      const all = await numbers();
      expect(all).toEqual(Array.from({ length: all.length }, (_, i) => 5000 + i));
    } finally {
      await t.pool.query('DROP TRIGGER test_fail_invoice ON invoices; DROP FUNCTION test_fail_invoice();');
    }
  });
});
