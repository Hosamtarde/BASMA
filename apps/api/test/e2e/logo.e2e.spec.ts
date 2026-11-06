import request from 'supertest';
import { HttpMethod, requestFor, startTestApp, TestApp } from '../support/app';

jest.setTimeout(180_000);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);

describe('Lab logo (e2e)', () => {
  let t: TestApp;
  const url = '/api/v1/settings/logo';
  const upload = (data: Buffer, filename: string, contentType: string) =>
    request(t.http).put(url).set('Authorization', t.auth).attach('file', data, { filename, contentType });

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it.each([['get'], ['put'], ['delete']] as [HttpMethod][])('%s → 401 / 403', async (method) => {
    await requestFor(t.http, method, url).expect(401);
    await requestFor(t.http, method, url).set('Authorization', t.limitedAuth).expect(403);
  });

  it('has no stored logo at first (clients use the bundled default)', async () => {
    const res = await request(t.http).get(url).set('Authorization', t.auth).expect(404);
    expect(res.body.error.code).toBe('error.not_found');
  });

  it('stores a PNG in the database and serves it back with the detected type', async () => {
    const res = await upload(PNG, 'logo.png', 'image/png').expect(200);
    expect(res.body.logo).toMatchObject({ present: true, mimeType: 'image/png', sizeBytes: PNG.length });

    const got = await request(t.http)
      .get(url)
      .set('Authorization', t.auth)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers.etag).toBe(`"${res.body.logo.sha256 as string}"`);
    expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);

    const { rows } = await t.pool.query(`SELECT size_bytes FROM lab_logo`);
    expect(rows).toEqual([{ size_bytes: PNG.length }]);
  });

  it('replaces it with a JPEG, typed from the bytes even if the client says otherwise', async () => {
    const res = await upload(JPEG, 'logo.png', 'image/png').expect(200);
    expect(res.body.logo.mimeType).toBe('image/jpeg');
  });

  it.each([
    [
      'SVG',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'image/svg+xml',
    ],
    ['text renamed to .png', Buffer.from('definitely not an image'), 'image/png'],
  ])('rejects %s with 415 and keeps the previous logo', async (_label, data, type) => {
    const res = await upload(data, 'logo.png', type).set('Accept-Language', 'en').expect(415);
    expect(res.body.error).toMatchObject({
      code: 'error.logo.invalid_type',
      message: 'The logo must be a PNG or JPEG image.',
    });
    const settings = await request(t.http).get('/api/v1/settings').set('Authorization', t.auth).expect(200);
    expect(settings.body.logo.mimeType).toBe('image/jpeg');
  });

  it('rejects a file over 1 MB with 413', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1_048_576)]);
    const res = await upload(big, 'big.png', 'image/png').expect(413);
    expect(res.body.error.code).toBe('error.payload_too_large');
  });

  it('rejects a request without a file', async () => {
    const res = await request(t.http).put(url).set('Authorization', t.auth).send({}).expect(400);
    expect(res.body.error.code).toBe('error.logo.missing');
  });

  it('removes the logo (idempotent) and audits each change', async () => {
    await request(t.http).delete(url).set('Authorization', t.auth).expect(204);
    await request(t.http).delete(url).set('Authorization', t.auth).expect(204);
    await request(t.http).get(url).set('Authorization', t.auth).expect(404);

    const { rows } = await t.pool.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE action LIKE 'settings.logo%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'settings.logo_updated',
      'settings.logo_updated',
      'settings.logo_removed',
    ]);
  });
});
