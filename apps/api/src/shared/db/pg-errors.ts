/** PostgreSQL SQLSTATE codes we react to. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code: string;
  constraint?: string;
}

/**
 * Finds the PostgreSQL error inside a (possibly wrapped) error: Drizzle wraps driver
 * errors and keeps the original in `cause`.
 */
export function pgErrorOf(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const candidate = current as Error & { code?: unknown; constraint?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === 'string' ? { constraint: candidate.constraint } : {}),
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

export const isForeignKeyViolation = (error: unknown): boolean =>
  pgErrorOf(error)?.code === PG_FOREIGN_KEY_VIOLATION;

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === constraint;
}
