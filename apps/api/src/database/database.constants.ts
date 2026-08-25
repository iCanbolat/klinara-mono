import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

/** Drizzle örneği için DI token'ı. */
export const DRIZZLE = Symbol('DRIZZLE');
/** Ham `pg.Pool` — sağlık kontrolü gibi kiracı context'i gerektirmeyen işler için. */
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;
