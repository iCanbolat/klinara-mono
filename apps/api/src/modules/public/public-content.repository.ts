import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';

/**
 * Public sayfanın okuduğu veriler.
 *
 * Bu sorgular kiracı ÇÖZÜLDÜKTEN SONRA, olağan `*_isolation` politikaları
 * altında koşar — `app.public_flow` burada devrede DEĞİLDİR. Yani içerik,
 * ayar ve katalog erişimi iç panelinkiyle aynı izolasyon kurallarına tabi.
 *
 * `select *` yok: dönen her kolon public bir sayfada görünecek demek. Alan
 * listesini sorguda daraltmak, sunum katmanındaki beyaz listeyi ikinci bir
 * savunma hattı hâline getiriyor.
 */

export interface PublicSiteRow {
  siteId: string;
  status: string;
  defaultBranchId: string | null;
  tenantName: string;
  timezone: string;
  currency: string;
  revisionId: string | null;
  revisionNumber: number | null;
  contentHash: string | null;
  theme: Record<string, unknown>;
  sections: unknown[];
  seo: Record<string, unknown>;
}

export async function findPublishedSite(
  tx: Tx,
  siteId: string,
): Promise<PublicSiteRow | undefined> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select s.id            as site_id,
           s.status::text  as status,
           s.default_branch_id,
           t.name          as tenant_name,
           t.timezone,
           t.currency,
           r.id            as revision_id,
           r.revision_number,
           r.content_hash,
           r.theme,
           r.sections,
           r.seo
      from booking_sites s
      join tenants t on t.id = s.tenant_id
      left join booking_page_revisions r on r.id = s.published_revision_id
     where s.id = ${siteId}
       and s.deleted_at is null
     limit 1
  `);

  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    siteId: row['site_id'] as string,
    status: row['status'] as string,
    defaultBranchId: (row['default_branch_id'] as string | null) ?? null,
    tenantName: row['tenant_name'] as string,
    timezone: row['timezone'] as string,
    currency: row['currency'] as string,
    revisionId: (row['revision_id'] as string | null) ?? null,
    revisionNumber: (row['revision_number'] as number | null) ?? null,
    contentHash: (row['content_hash'] as string | null) ?? null,
    theme: (row['theme'] as Record<string, unknown> | null) ?? {},
    sections: (row['sections'] as unknown[] | null) ?? [],
    seo: (row['seo'] as Record<string, unknown> | null) ?? {},
  };
}

export interface PublicBranchRow {
  id: string;
  name: string;
  timezone: string;
  phone: string | null;
  address: string | null;
}

/** Yalnız AKTİF şubeler; pasif bir şubeye randevu alınamaz. */
export async function listPublicBranches(tx: Tx): Promise<PublicBranchRow[]> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select id, name, timezone, phone, address
      from branches
     where deleted_at is null and is_active = true
     order by name
  `);
  return result.rows.map((row) => ({
    id: row['id'] as string,
    name: row['name'] as string,
    timezone: row['timezone'] as string,
    phone: (row['phone'] as string | null) ?? null,
    address: (row['address'] as string | null) ?? null,
  }));
}

export interface PublicServiceRow {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  categorySortOrder: number;
  durationMinutes: number;
  priceMinor: number;
  branchId: string;
}

/**
 * Online randevuya AÇIK hizmetler.
 *
 * `coalesce(o.is_online_bookable, s.is_online_bookable)` — şube override'ı
 * `null` iken hizmetin kendi bayrağına düşer. Aynı `coalesce` süre ve fiyat
 * için de uygulanıyor: public sayfada gösterilen değer, randevu alındığında
 * gerçekten uygulanacak değer olmalı.
 *
 * Süzgeç SORGUDA: "pasif hizmet sızmadı" kuralını sunum katmanına bırakmak,
 * bir gün başka bir presenter yazıldığında sessizce kaybolurdu.
 */
export async function listOnlineBookableServices(
  tx: Tx,
  branchIds: string[],
): Promise<PublicServiceRow[]> {
  if (branchIds.length === 0) return [];
  // Drizzle'ın `sql` şablonu bir JS dizisini TEK parametre olarak bağlamaz,
  // elemanlarına açar — `= any($1)` o yüzden çalışmıyor. Depodaki mevcut
  // kalıp (calendar.repository.ts) virgülle birleştirip `string_to_array` ile
  // geri kuruyor; parametre yine bağlı, enjeksiyon yüzeyi yok.
  const branchList = branchIds.join(',');
  const result = await tx.execute<Record<string, unknown>>(sql`
    select s.id,
           s.name,
           s.description,
           s.category_id,
           c.name       as category_name,
           c.sort_order as category_sort_order,
           coalesce(o.duration_minutes, s.duration_minutes) as duration_minutes,
           coalesce(o.price_minor, s.price_minor)           as price_minor,
           b.id         as branch_id
      from branches b
      cross join services s
      join service_categories c on c.id = s.category_id
      left join branch_service_overrides o
             on o.service_id = s.id and o.branch_id = b.id and o.deleted_at is null
     where b.id = any(string_to_array(${branchList}, ',')::uuid[])
       and s.deleted_at is null
       and c.deleted_at is null
       and c.is_active = true
       and coalesce(o.is_active, s.is_active) = true
       and coalesce(o.is_online_bookable, s.is_online_bookable) = true
     order by c.sort_order, c.name, s.name
  `);

  return result.rows.map((row) => ({
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string | null) ?? null,
    categoryId: row['category_id'] as string,
    categoryName: row['category_name'] as string,
    categorySortOrder: Number(row['category_sort_order']),
    durationMinutes: Number(row['duration_minutes']),
    priceMinor: Number(row['price_minor']),
    branchId: row['branch_id'] as string,
  }));
}

export interface PublicAssetRow {
  id: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

/**
 * İçerik dokümanında anılan varlıkların adresleri.
 *
 * Doküman yalnız `assetId` taşır; URL kompozisyonu sunucuda yapılır. Doküman
 * URL taşısaydı, editörden gelen keyfî bir adres public sayfaya girebilirdi.
 */
export async function findAssetsByIds(tx: Tx, ids: string[]): Promise<PublicAssetRow[]> {
  if (ids.length === 0) return [];
  const idList = ids.join(',');
  const result = await tx.execute<Record<string, unknown>>(sql`
    select id, storage_key, width, height, alt_text
      from tenant_assets
     where id = any(string_to_array(${idList}, ',')::uuid[])
       and deleted_at is null
       and status = 'ready'
  `);
  return result.rows.map((row) => ({
    id: row['id'] as string,
    storageKey: row['storage_key'] as string,
    width: (row['width'] as number | null) ?? null,
    height: (row['height'] as number | null) ?? null,
    altText: (row['alt_text'] as string | null) ?? null,
  }));
}
