import { sql } from 'drizzle-orm';
import type { RequestContext } from '../common/request-context';
import type { Database } from './database.constants';

/** Bir transaction içindeki Drizzle handle'ı. Repository'ler YALNIZCA bunu alır. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Açık bir transaction içinde kiracı context'ini daraltır.
 *
 * Kullanım yeri: platform yöneticisinin yeni bir kiracı oluşturduğu bootstrap
 * akışı. Kiracı satırı yazıldıktan sonra context o kiracıya sabitlenir ve
 * devamındaki yazımlar (ayarlar, ilk şube) NORMAL kiracı politikalarından
 * geçer.
 *
 * Alternatif, `branches` ve `tenant_settings` politikalarına platform_admin
 * istisnası eklemekti; o yol platform yöneticisine HER kiracının verisi
 * üzerinde sınırsız yazma hakkı verirdi. Bu yaklaşım istisnayı yalnız
 * `tenants` tablosuyla sınırlı tutar.
 */
export async function setTenantContext(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}

/**
 * Kiracı context'ini transaction'a yazar ve işi o transaction içinde koşturur.
 *
 * `set_config`in ÜÇÜNCÜ argümanı `true` — yani transaction-scoped. Bu tek
 * karakterlik ayrıntı mimarinin en kritik noktasıdır: `false` olsaydı ayar
 * bağlantıda kalır ve havuzdan aynı bağlantıyı alan BİR SONRAKİ İSTEK, önceki
 * kiracının context'iyle çalışırdı. Kiracılar arası veri sızıntısı tam olarak
 * böyle olur.
 *
 * Kural: repository fonksiyonları global `db` handle'ını KULLANMAZ, yalnızca
 * buradan gelen `tx`i alır. Bu kural ESLint ile de zorlanır.
 */
export async function withTenantTx<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.tenant_id',      ${ctx.tenantId ?? ''}, true),
        set_config('app.user_id',        ${ctx.userId ?? ''}, true),
        set_config('app.branch_id',      ${ctx.branchId ?? ''}, true),
        set_config('app.request_id',     ${ctx.requestId}, true),
        set_config('app.platform_admin', ${ctx.isPlatformAdmin ? 'on' : 'off'}, true)
    `);
    return fn(tx);
  });
}
