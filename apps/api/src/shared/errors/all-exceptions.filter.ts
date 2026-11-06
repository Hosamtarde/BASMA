import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { I18nService, TranslationParams } from '../i18n/i18n.service';
import { DomainError } from './domain-error';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    params: TranslationParams;
    correlationId: string;
    details?: unknown;
  };
}

const STATUS_CODES: Partial<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: 'error.auth.unauthenticated',
  [HttpStatus.FORBIDDEN]: 'error.auth.forbidden',
  [HttpStatus.NOT_FOUND]: 'error.not_found',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'error.payload_too_large',
  [HttpStatus.TOO_MANY_REQUESTS]: 'error.rate_limited',
};

/**
 * Single exit point for every error: stable code + localized message + correlation id.
 * Never exposes stack traces, SQL or file paths to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: unknown }>();
    const res = ctx.getResponse<Response>();
    const correlationId = typeof req.id === 'string' ? req.id : 'unknown';

    let status: number;
    let code: string;
    let params: TranslationParams = {};
    let details: unknown;

    if (exception instanceof DomainError) {
      ({ status, code, params, details } = exception);
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'error.rate_limited';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? (status >= 500 ? 'error.internal' : 'error.bad_request');
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'error.internal';
    }

    if (status >= 500) {
      // Full detail goes to the log only (patient data is never put into errors).
      this.logger.error({ err: exception, correlationId }, 'Unhandled error');
      params = { ...params, correlationId };
    }

    const language = this.i18n.resolveLanguage(req.headers['accept-language']);
    const body: ErrorEnvelope = {
      error: {
        code,
        message: this.i18n.translate(code, params, language),
        params,
        correlationId,
        ...(details === undefined ? {} : { details }),
      },
    };
    res.status(status).json(body);
  }
}
