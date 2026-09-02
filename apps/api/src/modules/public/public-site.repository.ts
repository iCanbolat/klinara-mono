import { and, eq, sql } from 'drizzle-orm';
import { bookingSiteDomains, bookingSites } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

/**
 * Public çözümlemenin gördüğü DAR küme.
 *
 * `select *` yok ve olmayacak: bu sorgular `app.public_flow` altında koşuyor,
 * yani dönen her kolon bayrağın etki alanının bir parçası. Dört alan yeterli.
 */
export interface ResolvedSite {
  siteId: string;
  tenantId: string;
  slug: string;
  defaultBranchId: string | null;
}

/**
 * Slug → site.
 *
 * `status = 'published'` filtresi BURADA YOK — politika (`booking_sites_public_lookup`,
 * 0035) hallediyor. Uygulama katmanına kopyalamak, iki yerde tutulan ve bir
 * gün ayrışacak bir kural yaratırdı.
 */
export async function findSiteBySlug(tx: Tx, slug: string): Promise<ResolvedSite | undefined> {
  const [row] = await tx
    .select({
      siteId: bookingSites.id,
      tenantId: bookingSites.tenantId,
      slug: bookingSites.slug,
      defaultBranchId: bookingSites.defaultBranchId,
    })
    .from(bookingSites)
    .where(eq(bookingSites.slug, slug))
    .limit(1);
  return row;
}

export interface ResolvedHost {
  host: string;
  slug: string;
  status: string;
  /** Kiracının kanonik adresi — 301 ve `<link rel="canonical">` için. */
  canonicalHost: string;
}

/**
 * Konak adı → slug.
 *
 * `dns_verified` satırlar da görünür (politika ikisine de izin veriyor); bu
 * sorgu `active` arar çünkü henüz sertifikası olmayan bir konak adı sayfa
 * döndüremez. İç uç (`/internal/booking-domains/authorize`) aynı politikayı
 * kullanır ama ikisini de kabul eder — ayrımı yapan uçtur, politika değil.
 */
export async function findByHost(tx: Tx, host: string): Promise<ResolvedHost | undefined> {
  const result = await tx.execute<Record<string, string | null>>(sql`
    select d.host,
           s.slug,
           s.status::text as status,
           coalesce(
             (select p.host
                from booking_site_domains p
               where p.booking_site_id = s.id and p.is_primary
               limit 1),
             d.host
           ) as canonical_host
      from booking_site_domains d
      join booking_sites s on s.id = d.booking_site_id
     where d.host = ${host}
       and d.verification_status = 'active'
     limit 1
  `);

  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    host: row['host'] as string,
    slug: row['slug'] as string,
    status: row['status'] as string,
    canonicalHost: row['canonical_host'] as string,
  };
}

/**
 * Kenar proxy'sinin sorusu: bu konak adı için sertifika alınabilir mi?
 *
 * Yanıt yalnız boolean. `dns_verified` de kabul edilir — Caddy tam olarak
 * sertifika almadan ÖNCE soruyor ve o an satır henüz `active` değil.
 * Yayınlanmamış bir siteye ait alan adı da kabul edilir: sertifika, sayfanın
 * yayında olmasından bağımsız olarak alınmalı, aksi hâlde klinik sayfasını
 * yayınladığı an TLS hatası görürdü.
 */
export async function findEdgeAuthorization(
  tx: Tx,
  host: string,
): Promise<{ id: string; tenantId: string; status: string } | undefined> {
  // `tenantId` DÖNÜYOR çünkü `dns_verified → active` terfisi bir YAZIM ve
  // public bayrağın altında yazım yok (politika `for select`). Terfi
  // `runForTenant` ile, olağan izolasyon politikası altında yapılır.
  const [row] = await tx
    .select({
      id: bookingSiteDomains.id,
      tenantId: bookingSiteDomains.tenantId,
      status: bookingSiteDomains.verificationStatus,
    })
    .from(bookingSiteDomains)
    .where(
      and(
        eq(bookingSiteDomains.host, host),
        sql`${bookingSiteDomains.verificationStatus} in ('active', 'dns_verified')`,
      ),
    )
    .limit(1);
  return row;
}

/**
 * `dns_verified → active` terfisi.
 *
 * Koşul `where`de: iki eş zamanlı kenar isteği geldiğinde ikincisi hiçbir
 * satır güncellemez ve `activated_at` bir kez yazılır. "Önce oku, sonra yaz"
 * biçiminde bir terfi bu yarışı sessizce kaybederdi.
 */
export function promoteToActiveSql(domainId: string, now: Date) {
  return sql`
    update booking_site_domains
       set verification_status = 'active',
           activated_at = ${now},
           failure_reason = null,
           updated_at = now()
     where id = ${domainId}
       and verification_status = 'dns_verified'
  `;
}
