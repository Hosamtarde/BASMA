import { ArgumentsHost, HttpStatus, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { I18nService } from '../i18n/i18n.service';
import { AllExceptionsFilter, ErrorEnvelope } from './all-exceptions.filter';
import { DomainError } from './domain-error';

function run(exception: unknown, acceptLanguage?: string) {
  const res = { statusCode: 0, body: undefined as ErrorEnvelope | undefined };
  const response = {
    status(code: number) {
      res.statusCode = code;
      return response;
    },
    json(body: ErrorEnvelope) {
      res.body = body;
    },
  };
  const request = { id: 'req-12345678', headers: { 'accept-language': acceptLanguage } };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter(new I18nService());
  // Silence the expected error log for 500s.
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return res;
}

describe('AllExceptionsFilter', () => {
  it('maps a DomainError to the envelope with a localized message', () => {
    const { statusCode, body } = run(new DomainError('error.setup.already_done', HttpStatus.CONFLICT), 'en');
    expect(statusCode).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'error.setup.already_done',
        message: 'The system has already been set up.',
        params: {},
        correlationId: 'req-12345678',
      },
    });
  });

  it('maps framework HTTP errors to catalog codes', () => {
    expect(run(new NotFoundException()).body?.error.code).toBe('error.not_found');
    expect(run(new PayloadTooLargeException()).body?.error.code).toBe('error.payload_too_large');
  });

  it('hides internal errors: generic code, no stack or message leakage, correlation id included', () => {
    const { statusCode, body } = run(new Error('relation "users" does not exist at C:\\secret\\path'));
    expect(statusCode).toBe(500);
    expect(body?.error.code).toBe('error.internal');
    const text = JSON.stringify(body);
    expect(text).not.toContain('relation "users"');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('stack');
    expect(body?.error.message).toContain('req-12345678');
  });
});
