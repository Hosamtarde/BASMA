import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export const NAME_MAX_LENGTH = 100;

/**
 * Owner rule (B1): Unicode NFC, trim, collapse repeated whitespace. No letter folding
 * (أحمد ≠ احمد); case-insensitive uniqueness is enforced by the database on lower(name).
 */
export function normalizeName(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Same normalization for optional free text (phone, clinic, notes); empty becomes null. */
export function normalizeOptionalText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.normalize('NFC').trim();
  return normalized === '' ? null : normalized;
}

const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

/** A required display name: normalized, 1–100 characters, no control characters. */
export const IsName = (max = NAME_MAX_LENGTH) =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeName(value) : value)),
    IsString(),
    Length(1, max),
    Matches(NO_CONTROL_CHARS),
  );

/** Escapes LIKE wildcards so user search text is matched literally. */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
