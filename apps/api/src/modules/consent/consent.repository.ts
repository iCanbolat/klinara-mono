import { and, desc, eq, sql } from 'drizzle-orm';
import {
  bookingConsentAcceptances,
  consentDocuments,
  CONSENT_KIND,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type ConsentDocumentRow = typeof consentDocuments.$inferSelect;
export type ConsentAcceptanceRow = typeof bookingConsentAcceptances.$inferSelect;

export async function findDraft(tx: Tx, siteId: string): Promise<ConsentDocumentRow | undefined> {
  const [row] = await tx
    .select()
    .from(consentDocuments)
    .where(and(eq(consentDocuments.bookingSiteId, siteId), eq(consentDocuments.status, 'draft')))
    .limit(1);
  return row;
}

export async function findById(tx: Tx, id: string): Promise<ConsentDocumentRow | undefined> {
  const [row] = await tx.select().from(consentDocuments).where(eq(consentDocuments.id, id)).limit(1);
  return row;
}

export async function listVersions(
  tx: Tx,
  siteId: string,
  limit: number,
): Promise<ConsentDocumentRow[]> {
  return tx
    .select()
    .from(consentDocuments)
    .where(eq(consentDocuments.bookingSiteId, siteId))
    .orderBy(desc(consentDocuments.version))
    .limit(limit);
}

export async function insertDraft(
  tx: Tx,
  values: { tenantId: string; bookingSiteId: string; body: string; sha256: string; locale: string },
): Promise<ConsentDocumentRow> {
  const [row] = await tx
    .insert(consentDocuments)
    .values({ ...values, kind: CONSENT_KIND, status: 'draft' })
    .returning();
  if (row === undefined) throw new Error('Onam taslağı oluşturulamadı');
  return row;
}

export async function updateDraft(
  tx: Tx,
  id: string,
  patch: { body: string; sha256: string; locale: string },
): Promise<ConsentDocumentRow | undefined> {
  const [row] = await tx
    .update(consentDocuments)
    .set(patch)
    .where(eq(consentDocuments.id, id))
    .returning();
  return row;
}

/**
 * Sürüm numarasını KİLİT ALTINDA üretir.
 *
 * `(booking_site_id, kind, version)` UNIQUE olduğu için kilit olmadan iki eş
 * zamanlı yayın 23505'e düşerdi — doğru sonuç, anlamsız hata. Kilidi site
 * satırı üzerinden almak `booking_page` yayınıyla aynı kalıp.
 */
export async function nextVersion(tx: Tx, siteId: string): Promise<number> {
  const result = await tx.execute<{ next: number }>(sql`
    select coalesce(max(version), 0) + 1 as next
      from consent_documents
     where booking_site_id = ${siteId}
  `);
  return Number(result.rows[0]?.next ?? 1);
}

export async function publishDraft(
  tx: Tx,
  id: string,
  values: { version: number; publishedBy: string | null },
): Promise<ConsentDocumentRow | undefined> {
  const [row] = await tx
    .update(consentDocuments)
    .set({ ...values, status: 'published', publishedAt: new Date() })
    .where(eq(consentDocuments.id, id))
    .returning();
  return row;
}

/** Yayındaki metin arşive düşer; SİLİNMEZ — eski kabuller ona bağlı. */
export async function archive(tx: Tx, id: string): Promise<void> {
  await tx.update(consentDocuments).set({ status: 'archived' }).where(eq(consentDocuments.id, id));
}

export async function listAcceptances(
  tx: Tx,
  filter: { customerId?: string; appointmentId?: string },
  limit: number,
): Promise<ConsentAcceptanceRow[]> {
  const conditions = [
    filter.customerId === undefined
      ? undefined
      : eq(bookingConsentAcceptances.customerId, filter.customerId),
    filter.appointmentId === undefined
      ? undefined
      : eq(bookingConsentAcceptances.appointmentId, filter.appointmentId),
  ].filter((condition) => condition !== undefined);

  return tx
    .select()
    .from(bookingConsentAcceptances)
    .where(and(...conditions))
    .orderBy(desc(bookingConsentAcceptances.acceptedAt))
    .limit(limit);
}
