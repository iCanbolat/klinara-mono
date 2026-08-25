import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Env } from '../config/env.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Uygulama bağlantı havuzu.
 *
 * `DATABASE_URL` NOBYPASSRLS bir role işaret eder — kiracı izolasyonu buna bağlıdır.
 * Migration'lar ayrı bir bağlantıyla (`DATABASE_MIGRATION_URL`, tablo sahibi rol)
 * koşar; ikisini karıştırmak RLS'i etkisiz hâle getirir.
 */
export interface CreateDbOptions {
  /** Havuzdaki boştaki bağlantılarda oluşan hatalar buraya bildirilir. */
  onPoolError?: (error: Error) => void;
}

export function createDb(env: Env, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    // Kaçak sorguların havuzu tüketmesini engeller.
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'klinara-api',
  });

  // KRİTİK: pg.Pool boştaki bir bağlantı koptuğunda 'error' yayar (DB restart,
  // failover, ağ kesintisi). Dinleyici YOKSA Node bunu yakalanmamış istisna
  // sayar ve SÜRECİ ÖLDÜRÜR. Havuz kopan bağlantıyı zaten kendisi yeniler;
  // bizim tek işimiz olayı yutmadan loglamak.
  pool.on('error', (error: Error) => {
    options.onPoolError?.(error);
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
