import type { TFunction } from 'i18next';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/api/errors';

/**
 * Zod schemas carry catalog keys (not text) so messages follow the UI language at render time:
 * `msg('validation.minLength', { count: 10 })` → "validation.minLength|{"count":10}".
 */
export function msg(key: string, params?: Record<string, string | number>): string {
  return params ? `${key}|${JSON.stringify(params)}` : key;
}

const RAW = 'raw:';
/** A message that is already final text (e.g. the server's localized answer), not a catalog key. */
export const rawMsg = (text: string): string => RAW + text;

export function renderMessage(t: TFunction, message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (message.startsWith(RAW)) return message.slice(RAW.length);
  const [key = '', raw] = message.split('|');
  const params = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  // Keys come from our own schemas (typed catalog keys are checked where they are written).
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  return translate(key, params);
}

/**
 * Marks the fields the server rejected (details.fields use the API's dotted names, which the
 * forms mirror) and returns the server's localized message for the form-level alert.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  known: readonly Path<T>[],
): string | null {
  if (!(err instanceof ApiError)) return null;
  // "Name already used" belongs on the name field, in the server's words (SPEC §5.4).
  if (err.code.endsWith('.name_taken') && (known as readonly string[]).includes('name')) {
    setError('name' as Path<T>, { type: 'server', message: rawMsg(err.message) });
    return null;
  }
  for (const f of err.fields) {
    if ((known as readonly string[]).includes(f.field)) {
      setError(f.field as Path<T>, { type: 'server', message: msg('validation.invalid') });
    }
  }
  return err.message;
}
