import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../errors/domain-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ADR-0010: the Idempotency-Key header is a UUID chosen by the client for one logical attempt. */
export function parseIdempotencyKey(header: string | string[] | undefined): string | undefined {
  if (header === undefined) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !UUID.test(value.trim())) {
    throw new DomainError('error.idempotency.required', HttpStatus.BAD_REQUEST);
  }
  return value.trim().toLowerCase();
}

export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = parseIdempotencyKey(header);
  if (key === undefined) throw new DomainError('error.idempotency.required', HttpStatus.BAD_REQUEST);
  return key;
}

/** First call: 201 (as declared). A replay answers 200 with the original body and says so. */
export function markReplay(res: Response, replayed: boolean): void {
  if (replayed) {
    res.status(HttpStatus.OK);
    res.setHeader('Idempotent-Replayed', 'true');
  }
}
