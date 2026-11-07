import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { API_PREFIX } from '../../../config/api';
import { DomainError } from '../../../shared/errors/domain-error';

/**
 * The refresh token travels only in this cookie (ADR-0004, Phase 2): httpOnly so page scripts
 * never see it, SameSite=Strict and scoped to the auth routes so no other request carries it.
 */
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

/** Base64url of 32 random bytes is 43 characters; anything far longer is not ours. */
const MAX_TOKEN_LENGTH = 200;

export function setRefreshCookie(req: Request, res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    // The installed app is plain http on 127.0.0.1; Secure is added whenever HTTPS is used.
    secure: req.secure,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    secure: req.secure,
  });
}

/** Reads the refresh cookie from the raw Cookie header (no parser dependency needed for one cookie). */
export function readRefreshCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
    return value.length > 0 && value.length <= MAX_TOKEN_LENGTH ? value : null;
  }
  return null;
}

/**
 * CSRF defence in depth for the cookie routes. SameSite=Strict already stops other sites, but
 * every port on 127.0.0.1 is the *same site*, so a page served by another local program could
 * still send the cookie. Browsers always send Origin on POST and Sec-Fetch-Site on modern
 * engines; non-browser clients (tests, curl) send neither and carry no ambient cookie anyway.
 */
export function assertSameOrigin(headers: Request['headers']): void {
  const fetchSite = headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') throw forbidden();
  const origin = headers.origin;
  if (origin === undefined) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden();
  }
  if (originHost !== headers.host) throw forbidden();
}

const forbidden = () => new DomainError('error.auth.forbidden', HttpStatus.FORBIDDEN);
