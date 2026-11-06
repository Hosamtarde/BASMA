import { sql } from 'drizzle-orm';
import type { Tx } from './database';

export const CURRENCY_SETTING_KEY = 'currency';

/**
 * Every write that stores a money amount takes a SHARE lock on the currency setting.
 * Changing the currency code/decimals takes an UPDATE lock and then checks for money data,
 * so the two can never interleave (no amount saved under decimals that change underneath it).
 */
export async function lockCurrencyForMoneyWrite(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM settings WHERE key = ${CURRENCY_SETTING_KEY} FOR SHARE`);
}
