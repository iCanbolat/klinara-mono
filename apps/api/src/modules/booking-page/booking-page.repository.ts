import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  bookingPageRevisions,
  bookingSiteSettings,
  bookingSites,
  tenants,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type BookingSiteRow = typeof bookingSites.$inferSelect;
export type BookingSiteSettingsRow = typeof bookingSiteSettings.$inferSelect;
export type BookingPageRevisionRow = typeof bookingPageRevisions.$inferSelect;

export async function findSite(tx: Tx): Promise<BookingSiteRow | undefined> {
  const [row] = await tx.select().from(bookingSites).where(isNull(bookingSites.deletedAt)).limit(1);
  return row;
}

/**
 * Site satırını YAZMA KİLİDİ altında okur.
 *
 * `If-Match` kontrolü ile taslak işaretçisinin taşınması arasında bir yarış
 * penceresi kalmasın diye: iki eş zamanlı kaydetmeden ikincisi kilidi bekler
 * ve kilidi aldığında `draft_revision_id` çoktan taşınmış olur — sürüm
 * karşılaştırması 409 verir. Kilit olmasaydı ikisi de kontrolü geçer,
 * `(booking_site_id, revision_number)` UNIQUE'i 23505'e düşerdi: doğru sonuç
 * ama istemciye anlamsız bir hata.
 */
export async function lockSite(tx: Tx, siteId: string): Promise<BookingSiteRow | undefined> {
  const [row] = await tx
    .select()
    .from(bookingSites)
    .where(eq(bookingSites.id, siteId))
    .limit(1)
    .for('update');
  return row;
}

export async function findTenantSlug(tx: Tx, tenantId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.slug;
}

export async function insertSite(
  tx: Tx,
  values: { tenantId: string; slug: string; defaultBranchId: string | null },
): Promise<BookingSiteRow> {
  const [row] = await tx.insert(bookingSites).values(values).returning();
  if (row === undefined) throw new Error('Randevu sayfası oluşturulamadı');
  return row;
}

export async function updateSite(
  tx: Tx,
  siteId: string,
  patch: Partial<{
    defaultBranchId: string | null;
    status: 'draft' | 'published' | 'unpublished';
    publishedRevisionId: string | null;
    draftRevisionId: string | null;
    publishedAt: Date | null;
  }>,
): Promise<BookingSiteRow | undefined> {
  const [row] = await tx
    .update(bookingSites)
    .set(patch)
    .where(eq(bookingSites.id, siteId))
    .returning();
  return row;
}

// --- Ayarlar ---

export async function findSettings(
  tx: Tx,
  siteId: string,
): Promise<BookingSiteSettingsRow | undefined> {
  const [row] = await tx
    .select()
    .from(bookingSiteSettings)
    .where(eq(bookingSiteSettings.bookingSiteId, siteId))
    .limit(1);
  return row;
}

export async function insertDefaultSettings(
  tx: Tx,
  tenantId: string,
  siteId: string,
): Promise<BookingSiteSettingsRow> {
  const [row] = await tx
    .insert(bookingSiteSettings)
    .values({ bookingSiteId: siteId, tenantId, locales: ['tr'] })
    .returning();
  if (row === undefined) throw new Error('Randevu sayfası ayarları oluşturulamadı');
  return row;
}

export async function updateSettings(
  tx: Tx,
  siteId: string,
  patch: Partial<typeof bookingSiteSettings.$inferInsert>,
): Promise<BookingSiteSettingsRow | undefined> {
  const [row] = await tx
    .update(bookingSiteSettings)
    .set(patch)
    .where(eq(bookingSiteSettings.bookingSiteId, siteId))
    .returning();
  return row;
}

/**
 * Yayındaki onam metninin özeti — gövde OLMADAN.
 *
 * Ayarlar ekranı 20k'lık bir metni taşımamalı; gövde `/consent-document`
 * ucundan geliyor. Yayının tek kaynağı `active_consent_document_id` pointer'ı
 * (`published_revision_id` ile aynı gerekçe: `status`'a bakmak ikinci bir
 * gerçek yaratırdı).
 */
export async function findActiveConsentSummary(
  tx: Tx,
  siteId: string,
): Promise<{ id: string; version: number; locale: string; sha256: string; publishedAt: string } | null> {
  const result = await tx.execute<{
    id: string;
    version: number;
    locale: string;
    sha256: string;
    published_at: Date;
  }>(sql`
    select d.id, d.version, d.locale, d.sha256, d.published_at
      from booking_site_settings s
      join consent_documents d on d.id = s.active_consent_document_id
     where s.booking_site_id = ${siteId}
     limit 1
  `);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    version: Number(row.version),
    locale: row.locale,
    sha256: row.sha256,
    publishedAt: new Date(row.published_at).toISOString(),
  };
}

// --- İçerik sürümleri ---

export async function findRevision(
  tx: Tx,
  revisionId: string,
): Promise<BookingPageRevisionRow | undefined> {
  const [row] = await tx
    .select()
    .from(bookingPageRevisions)
    .where(eq(bookingPageRevisions.id, revisionId))
    .limit(1);
  return row;
}

/**
 * Yeni sürüm yazar.
 *
 * `revision_number` en büyükten +1 ile üretiliyor ve `(booking_site_id,
 * revision_number)` UNIQUE: eş zamanlı iki taslak kaydı aynı numarayı
 * alamıyor, ikincisi 23505 ile düşüyor. Sayacı ayrı bir kolonda tutup
 * güncellemek, aynı yarışı sessizce kazandırırdı.
 */
export async function insertRevision(
  tx: Tx,
  values: {
    tenantId: string;
    bookingSiteId: string;
    schemaVersion: number;
    locale: string;
    theme: unknown;
    sections: unknown;
    seo: unknown;
    contentHash: string;
    createdBy: string | null;
  },
): Promise<BookingPageRevisionRow> {
  const [row] = await tx
    .insert(bookingPageRevisions)
    .values({
      ...values,
      revisionNumber: sql`(
        select coalesce(max(r.revision_number), 0) + 1
          from booking_page_revisions r
         where r.booking_site_id = ${values.bookingSiteId}
      )`,
    })
    .returning();
  if (row === undefined) throw new Error('İçerik sürümü yazılamadı');
  return row;
}

export async function listRevisions(
  tx: Tx,
  siteId: string,
  limit: number,
): Promise<BookingPageRevisionRow[]> {
  return tx
    .select()
    .from(bookingPageRevisions)
    .where(eq(bookingPageRevisions.bookingSiteId, siteId))
    .orderBy(desc(bookingPageRevisions.revisionNumber))
    .limit(limit);
}

/** Sürümün gerçekten BU siteye ait olduğunu doğrular (geri alma ucu için). */
export async function findRevisionOfSite(
  tx: Tx,
  siteId: string,
  revisionId: string,
): Promise<BookingPageRevisionRow | undefined> {
  const [row] = await tx
    .select()
    .from(bookingPageRevisions)
    .where(
      and(
        eq(bookingPageRevisions.bookingSiteId, siteId),
        eq(bookingPageRevisions.id, revisionId),
      ),
    )
    .limit(1);
  return row;
}
