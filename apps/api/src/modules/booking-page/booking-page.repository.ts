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
