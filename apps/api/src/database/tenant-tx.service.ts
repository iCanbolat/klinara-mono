import { Inject, Injectable } from '@nestjs/common';
import { RequestContextService } from '../common/request-context';
import { DRIZZLE, type Database } from './database.constants';
import { withTenantTx, type Tx } from './tenant-tx';

/**
 * Kiracı kapsamlı transaction'ların tek giriş noktası.
 *
 * Servisler veritabanına YALNIZCA buradan ulaşır. Böylece hiçbir sorgu kiracı
 * context'i yazılmadan koşamaz; `app.tenant_id` set edilmemiş bir sorgu RLS
 * yüzünden boş küme görür (veya yanlış kiracının verisini görür — çok daha
 * kötüsü).
 */
@Injectable()
export class TenantTxService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly requestContext: RequestContextService,
  ) {}

  /** Kiracı kapsamlı transaction. Kiracı context'i yoksa 401 verir. */
  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.requestContext.requireTenantId();
    const ctx = this.requestContext.get();
    if (ctx === undefined) throw new Error('İstek bağlamı bulunamadı');
    return withTenantTx(this.db, ctx, fn);
  }

  /** Platform yönetimi kapsamlı transaction (kiracı context'i olmadan). */
  async runAsPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = this.requestContext.requirePlatformAdmin();
    return withTenantTx(this.db, ctx, fn);
  }

  /** Geçerli isteğin kiracı kimliği. */
  get tenantId(): string {
    return this.requestContext.requireTenantId();
  }
}
