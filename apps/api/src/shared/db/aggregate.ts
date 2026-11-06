import { nameTaken, notFound, staleVersion } from '../errors/common-errors';
import { isUniqueViolation } from './pg-errors';

/**
 * Loads-for-update result check: 404 when missing, 409 when the client's rowVersion is outdated.
 * Narrows the record type for the caller.
 */
export function assertCurrent<T extends { rowVersion: number }>(
  record: T | undefined,
  rowVersion: number,
): T {
  if (!record) throw notFound();
  if (record.rowVersion !== rowVersion) throw staleVersion();
  return record;
}

/** Only the fields that were sent AND differ from the stored value. */
export function changedFields<T extends object>(current: T, patch: Partial<T>): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined && value !== current[key]) changes[key] = value;
  }
  return changes;
}

/** Maps the case-insensitive unique-name index violation to a 409 with a catalog code. */
export async function withUniqueName<T>(
  work: () => Promise<T>,
  constraint: string,
  entity: string,
  name: string | undefined,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, constraint)) throw nameTaken(entity, name ?? '');
    throw error;
  }
}
