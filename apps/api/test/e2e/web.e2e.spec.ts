import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { startTestApp, TestApp } from '../support/app';

jest.setTimeout(180_000);

const INDEX = '<!doctype html><html lang="ar" dir="rtl"><title>ui</title><div id="root"></div></html>';

describe('serving the built UI (WEB_DIST_DIR)', () => {
  let t: TestApp;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'web-dist-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), INDEX);
    writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1);');
    writeFileSync(path.join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    t = await startTestApp({ WEB_DIST_DIR: dist });
  });

  afterAll(async () => {
    await t?.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it.each(['/', '/login', '/cases/12', '/settings/lab?tab=logo'])(
    'returns index.html for the client route %s',
    async (url) => {
      const res = await request(t.http).get(url).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toBe(INDEX);
    },
  );

  it('serves hashed assets with a long cache, other files revalidated', async () => {
    const js = await request(t.http).get('/assets/app-abc123.js').expect(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const icon = await request(t.http).get('/favicon.svg').expect(200);
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('never answers a missing file or an unknown API path with the page', async () => {
    const asset = await request(t.http).get('/assets/missing.js').expect(404);
    expect(asset.text).toBe('Not Found');
    const api = await request(t.http).get('/api/v1/no-such-route').expect(404);
    expect(api.body.error.code).toBe('error.not_found');
    await request(t.http).get('/api/v1/setup/status').expect(200);
    const post = await request(t.http).post('/some/page').expect(404);
    expect(post.text).toBe('Not Found');
  });

  it('sends one explicit CSP: same origin, blob: images, no upgrade-insecure-requests', async () => {
    const res = await request(t.http).get('/').expect(200);
    const csp = res.headers['content-security-policy'] as string;
    const directives = Object.fromEntries(
      csp.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'default-src': "'self'",
      'base-uri': "'self'",
      'script-src': "'self'",
      'script-src-attr': "'none'",
      'style-src': "'self' 'unsafe-inline'",
      'img-src': "'self' blob:",
      'font-src': "'self'",
      'connect-src': "'self'",
      'object-src': "'none'",
      'frame-ancestors': "'none'",
      'form-action': "'self'",
    });
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
