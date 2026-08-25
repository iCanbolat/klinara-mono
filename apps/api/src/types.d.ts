import 'fastify';
import type pg from 'pg';
import type { Database } from './db/client.js';
import type { BusinessMetrics } from './plugins/metrics.js';
import type { TenantContext, Tx } from './db/tenant-tx.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Drizzle örneği. Kiracı kapsamlı sorgular için `withTenantTx` kullanın (Batch 0.4). */
    db: Database;
    /** Ham havuz — sağlık kontrolü ve kiracı context'i gerektirmeyen işler için. */
    pool: pg.Pool;
    /** İş metrikleri (randevu, çakışma, bildirim sayaçları). */
    metrics: BusinessMetrics;
    /** Kiracı kapsamlı transaction. Kiracı context'i yoksa hata verir. */
    tenantTx<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T>;
    /** Platform yönetimi kapsamlı transaction. */
    platformTx<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T>;
  }

  interface FastifyRequest {
    /** İsteğin kiracı/kullanıcı/şube bağlamı. */
    ctx: TenantContext;
  }

  interface FastifyContextConfig {
    /**
     * Kimlik doğrulaması gerektirmeyen uç. Batch 1.3'teki auth guard'ı bu
     * bayrağa bakar; işaretlenmemiş her uç kimlik doğrulaması ister.
     * Public uçların AÇIKÇA işaretlenmesi, unutulan bir guard'ın sessizce
     * uç açmasını engeller.
     */
    public?: boolean;
  }
}
