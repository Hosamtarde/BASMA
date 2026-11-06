import type { Tx } from './database';
import { isForeignKeyViolation } from './pg-errors';

export type DeleteOutcome = 'deleted' | 'deactivated';

/**
 * Owner rule (B1): hard delete if the record was never used, otherwise deactivate.
 * "Used" = another row references it (FK RESTRICT), so later milestones (cases, payments)
 * are covered without changes here.
 *
 * The delete runs in a SAVEPOINT so a refused delete leaves the outer transaction usable.
 * Only a foreign-key violation (23503) means "in use"; every other error propagates unchanged.
 */
export async function deleteOrDeactivate(
  tx: Tx,
  hardDelete: (savepoint: Tx) => Promise<void>,
  deactivate: (tx: Tx) => Promise<void>,
): Promise<DeleteOutcome> {
  try {
    await tx.transaction(async (savepoint) => {
      await hardDelete(savepoint);
    });
    return 'deleted';
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;
    await deactivate(tx);
    return 'deactivated';
  }
}
