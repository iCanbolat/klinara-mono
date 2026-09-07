import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';

/**
 * Yayındaki onam metni — pointer üzerinden.
 *
 * `booking_site_settings.active_consent_document_id` yayının TEK kaynağı;
 * `consent_documents.status`'a bakarak seçmek ikinci bir gerçek yaratırdı ve
 * ikisi bir gün ayrışırdı (`booking_sites.published_revision_id` ile aynı
 * gerekçe).
 */
export interface ActiveConsentRow {
  id: string;
  version: number;
  locale: string;
  body: string;
  sha256: string;
}

export async function findActiveConsent(
  tx: Tx,
  siteId: string,
): Promise<ActiveConsentRow | undefined> {
  const result = await tx.execute<Record<string, string | number>>(sql`
    select d.id, d.version, d.locale, d.body, d.sha256
      from booking_site_settings s
      join consent_documents d on d.id = s.active_consent_document_id
     where s.booking_site_id = ${siteId}
     limit 1
  `);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    id: String(row['id']),
    version: Number(row['version']),
    locale: String(row['locale']),
    body: String(row['body']),
    sha256: String(row['sha256']),
  };
}
