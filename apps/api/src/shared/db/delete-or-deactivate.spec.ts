import { DatabaseError } from 'pg';
import type { Tx } from './database';
import { deleteOrDeactivate } from './delete-or-deactivate';
import { isUniqueViolation, pgErrorOf } from './pg-errors';

function pgError(code: string, constraint?: string): DatabaseError {
  const e = new DatabaseError('db error', 0, 'error');
  e.code = code;
  if (constraint) e.constraint = constraint;
  return e;
}

/** Wraps like Drizzle does (original driver error in `cause`). */
const wrapped = (inner: Error) => new Error('Failed query', { cause: inner });

function fakeTx(): Tx {
  return {
    transaction: async (fn: (sp: Tx) => Promise<void>) => fn({} as Tx),
  } as unknown as Tx;
}

describe('deleteOrDeactivate', () => {
  it('returns "deleted" when the delete succeeds and never deactivates', async () => {
    const deactivate = jest.fn();
    await expect(deleteOrDeactivate(fakeTx(), () => Promise.resolve(), deactivate)).resolves.toBe('deleted');
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('deactivates on a foreign-key violation (23503), also when wrapped', async () => {
    for (const error of [pgError('23503'), wrapped(pgError('23503'))]) {
      const deactivate = jest.fn(() => Promise.resolve());
      const outcome = await deleteOrDeactivate(fakeTx(), () => Promise.reject(error), deactivate);
      expect(outcome).toBe('deactivated');
      expect(deactivate).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['unique violation', pgError('23505')],
    ['check violation', pgError('23514')],
    ['serialization failure', wrapped(pgError('40001'))],
    ['non-database error', new Error('boom')],
  ])('propagates any other error unchanged (%s)', async (_label, error) => {
    const deactivate = jest.fn();
    await expect(deleteOrDeactivate(fakeTx(), () => Promise.reject(error), deactivate)).rejects.toBe(error);
    expect(deactivate).not.toHaveBeenCalled();
  });
});

describe('pg error helpers', () => {
  it('finds code and constraint through wrapping', () => {
    expect(pgErrorOf(wrapped(pgError('23505', 'doctors_name_lower_uq')))).toEqual({
      code: '23505',
      constraint: 'doctors_name_lower_uq',
    });
    expect(
      isUniqueViolation(wrapped(pgError('23505', 'doctors_name_lower_uq')), 'doctors_name_lower_uq'),
    ).toBe(true);
    expect(isUniqueViolation(pgError('23505', 'other'), 'doctors_name_lower_uq')).toBe(false);
    expect(pgErrorOf(new Error('plain'))).toBeUndefined();
  });
});
