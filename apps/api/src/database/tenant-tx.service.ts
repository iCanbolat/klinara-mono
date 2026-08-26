import { Inject, Injectable } from '@nestjs/common';
import { emptyContext, RequestContextService } from '../common/request-context';
import { DRIZZLE, type Database } from './database.constants';
import { withAuthTx, withTenantTx, type Tx } from './tenant-tx';

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

  /**
   * Kimlik akışı transaction'ı: kiracı seçilmeden önce koşan sorgular.
   *
   * YALNIZ kimlik modülünden çağrılır (giriş, davet, parola, passkey, telefon).
   * `app.auth_flow` bayrağı kimlik tablolarını açar; iş verisi tablolarının
   * politikalarında bu bayrak hiç geçmez.
   */
  async runAsAuth<T>(
    fn: (tx: Tx) => Promise<T>,
    options: { actorUserId?: string } = {},
  ): Promise<T> {
    const ctx = this.requestContext.get() ?? emptyContext();
    // `actorUserId`: giriş akışında kullanıcı henüz istek bağlamında yoktur ama
    // BİRİNCİ FAKTÖR DOĞRULANMIŞTIR. Aktörü açıkça vermek, kiracı listesi gibi
    // sorguların politikada kullanıcıya daraltılabilmesini sağlar
    // (bkz. `tenants_auth_flow_read`).
    return withAuthTx(this.db, ctx, fn, options.actorUserId);
  }

  /** Kiracıyı açıkça vererek koşan kiracı kapsamlı transaction. */
  async runForTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = this.requestContext.get() ?? emptyContext();
    return withTenantTx(this.db, { ...ctx, tenantId }, fn);
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
