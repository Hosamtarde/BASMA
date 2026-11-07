import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { assertSameOrigin, readRefreshCookie, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './refresh-cookie';

describe('refresh cookie', () => {
  it('is scoped to the auth routes', () => {
    expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
  });

  describe('readRefreshCookie', () => {
    it('finds the cookie among others and decodes it', () => {
      expect(readRefreshCookie(`a=1; ${REFRESH_COOKIE}=abc%2Ddef; b=2`)).toBe('abc-def');
    });

    it.each([
      ['no header', undefined],
      ['empty header', ''],
      ['other cookies only', 'a=1; b=2'],
      ['a cookie whose name only ends with ours', `x_${REFRESH_COOKIE}=abc`],
      ['an empty value', `${REFRESH_COOKIE}=`],
      ['a broken escape', `${REFRESH_COOKIE}=%E0%A4%A`],
      ['an oversized value', `${REFRESH_COOKIE}=${'a'.repeat(201)}`],
    ])('returns null for %s', (_name, header) => {
      expect(readRefreshCookie(header)).toBeNull();
    });
  });

  describe('assertSameOrigin', () => {
    const host = '127.0.0.1:4310';
    const forbidden = (headers: Record<string, string>) => {
      try {
        assertSameOrigin({ host, ...headers });
      } catch (err) {
        return (
          err instanceof DomainError &&
          err.code === 'error.auth.forbidden' &&
          err.status === HttpStatus.FORBIDDEN
        );
      }
      return false;
    };

    it.each([
      ['no browser headers (non-browser client)', {}],
      ['same origin', { origin: 'http://127.0.0.1:4310', 'sec-fetch-site': 'same-origin' }],
      ['a direct navigation', { 'sec-fetch-site': 'none' }],
    ])('allows %s', (_name, headers) => {
      expect(forbidden(headers)).toBe(false);
    });

    it.each([
      ['another local port (same site, other origin)', { origin: 'http://127.0.0.1:5500' }],
      ['another site', { origin: 'https://evil.example' }],
      ['a same-site fetch', { 'sec-fetch-site': 'same-site' }],
      ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
      ['a null origin (sandboxed page)', { origin: 'null' }],
    ])('rejects %s', (_name, headers) => {
      expect(forbidden(headers)).toBe(true);
    });
  });
});
