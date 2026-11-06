import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A Drizzle transaction handle. Every write runs inside exactly one. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
