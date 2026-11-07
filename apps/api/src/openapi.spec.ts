import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { OpenAPIObject } from '@nestjs/swagger';
import { createApp } from './app.factory';
import { loadConfig } from './config/app-config';
import { buildOpenApiDocument } from './openapi';

jest.setTimeout(30_000);

describe('OpenAPI contract (built without a database)', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://openapi:unused@127.0.0.1:1/openapi',
        JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
        LOG_LEVEL: 'silent',
      }),
    );
    doc = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('publishes the error envelope schema', () => {
    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['ErrorEnvelope', 'ErrorBody', 'ErrorDetails', 'FieldError']),
    );
    expect(schemas['ErrorBody']).toMatchObject({
      required: expect.arrayContaining(['code', 'message', 'params', 'correlationId']),
    });
  });

  it('types every 4xx/5xx response with the envelope', () => {
    const untyped: string[] = [];
    for (const [url, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, { responses?: object }>)) {
        for (const [status, res] of Object.entries(op.responses ?? {})) {
          const ref = (res as { content?: Record<string, { schema?: { $ref?: string } }> }).content?.[
            'application/json'
          ]?.schema?.$ref;
          if (Number(status) >= 400 && ref !== '#/components/schemas/ErrorEnvelope') {
            untyped.push(`${method} ${url} ${status}`);
          }
        }
      }
    }
    expect(untyped).toEqual([]);
  });

  it('never exposes a refresh token in a response body', () => {
    expect(JSON.stringify(doc.components?.schemas?.['TokenResponse'])).not.toContain('"refreshToken"');
  });
});
