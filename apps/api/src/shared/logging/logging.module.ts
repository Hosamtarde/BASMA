import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import { APP_CONFIG } from '../../config/config.module';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Reuse a well-formed incoming X-Request-Id, otherwise generate one; echo it in the response. */
export function correlationId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: correlationId,
          // Bodies are never logged; headers carrying credentials are removed.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.currentPassword',
              '*.newPassword',
              '*.refreshToken',
              '*.accessToken',
            ],
            remove: true,
          },
          ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule {}
