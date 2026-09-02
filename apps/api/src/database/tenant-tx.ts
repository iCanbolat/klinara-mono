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
        set_config('app.platform_admin', ${ctx.isPlatformAdmin ? 'on' : 'off'}, true),
        set_config('app.auth_flow',      'off', true)
    `);
    return fn(tx);
  });
}

/**
 * Kimlik akışı transaction'ı — kiracı SEÇİLMEDEN önce koşan sorgular için.
 *
 * Giriş, parola sıfırlama, davet kabulü ve passkey doğrulaması "bu e-posta /
 * bu credential kime ait?" sorusunu cevaplamak zorundadır; cevap kiracıdan
 * bağımsızdır ve RLS bu soruya yardım edemez. `app.auth_flow` bayrağı bu
 * istisnayı AÇIK, tek isimli ve denetlenebilir kılar.
 *
 * Bayrak yalnız kimlik tablolarının politikalarında geçer: bir kiracının
 * randevusuna, müşterisine veya finansal kaydına ASLA erişim vermez. Alternatifi
 * (uygulama rolüne BYPASSRLS vermek) izolasyonun tamamını çöpe atardı.
 */
export async function withAuthTx<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.auth_flow',      'on', true),
        set_config('app.tenant_id',      ${ctx.tenantId ?? ''}, true),
        set_config('app.user_id',        ${actorUserId ?? ctx.userId ?? ''}, true),
        set_config('app.branch_id',      '', true),
        set_config('app.request_id',     ${ctx.requestId}, true),
        set_config('app.platform_admin', 'off', true)
    `);
    return fn(tx);
  });
}

/**
 * Public çözümleme transaction'ı — SLUG/KONAK ADI → KİRACI sorusu için.
 *
 * Online randevu sayfası kiracıyı seçmeden önce "bu slug kimin?" sorusunu
 * cevaplamak zorundadır; `tenants` ve `booking_sites` politikaları bağlamsız
 * bir sorguda boş küme döndürür. `app.public_flow` bu istisnayı AÇIK, tek
 * isimli ve denetlenebilir kılar.
 *
 * `withAuthTx` YENİDEN KULLANILMADI: `app.auth_flow` bayrağı `users`,
 * `credentials`, `auth_sessions`, `passkeys` ve `phone_verification_codes`
 * politikalarında geçiyor. Kimlik akışlarının hepsinde parola/passkey ispatı
 * var; randevu sayfasında hiçbir ispat yok — bayrağı paylaşmak, public
 * modüldeki tek bir dikkatsiz sorgunun kimlik bilgisi okuyabilmesi demekti.
 *
 * SÖZLEŞME: `current_public_flow()` yalnız `booking_sites` ve
 * `booking_site_domains` politikalarında geçer (0035). İkisi de dizin
 * verisidir — müşteri, randevu, içerik veya tema taşımazlar. Kuralı doğrulayan
 * bir entegrasyon testi var.
 *
 * Bu transaction bir kiracıyı SEÇER, işi yapmaz: çözümlemeden sonraki her
 * sorgu `withTenantTx` altında, olağan izolasyon politikalarıyla koşar.
 */
export async function withPublicTx<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.public_flow',    'on', true),
        set_config('app.auth_flow',      'off', true),
        set_config('app.tenant_id',      '', true),
        set_config('app.user_id',        '', true),
        set_config('app.branch_id',      '', true),
        set_config('app.request_id',     ${ctx.requestId}, true),
        set_config('app.platform_admin', 'off', true)
    `);
    return fn(tx);
  });
}
