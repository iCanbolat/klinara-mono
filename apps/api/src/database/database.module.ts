import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import type { EnvironmentVariables } from '../config/env.validation';
import { RequestContextService } from '../common/request-context';
import { DRIZZLE, PG_POOL, type Database } from './database.constants';
import * as schema from './schema';
import { TenantTxService } from './tenant-tx.service';

/**
 * Uygulama bağlantı havuzu.
 *
 * `DATABASE_URL` NOBYPASSRLS bir role işaret eder — kiracı izolasyonu buna
 * bağlıdır. Migration'lar ayrı bir bağlantıyla (`DATABASE_MIGRATION_URL`,
 * tablo sahibi rol) koşar; ikisini karıştırmak RLS'i etkisiz hâle getirir.
 */
function createPool(
  config: ConfigService<EnvironmentVariables, true>,
  logger: PinoLogger,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.get('DATABASE_URL', { infer: true }),
    max: config.get('DATABASE_POOL_MAX', { infer: true }),
    // Kaçak sorguların havuzu tüketmesini engeller.
    statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS', { infer: true }),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'klinara-api',
  });

  // KRİTİK: pg.Pool boştaki bir bağlantı koptuğunda 'error' yayar (DB restart,
  // failover, ağ kesintisi). Dinleyici YOKSA Node bunu yakalanmamış istisna
  // sayar ve SÜRECİ ÖLDÜRÜR. Havuz kopan bağlantıyı zaten kendisi yeniler;
  // bizim tek işimiz olayı yutmadan loglamak.
  pool.on('error', (error: Error) => {
    logger.error({ err: error }, 'Veritabanı havuzunda boştaki bağlantı hatası');
  });

  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService, PinoLogger],
      useFactory: createPool,
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
    },
    RequestContextService,
    TenantTxService,
  ],
  exports: [PG_POOL, DRIZZLE, RequestContextService, TenantTxService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Zarif kapanışın son adımı: in-flight istekler bittikten sonra havuzu kapat. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
