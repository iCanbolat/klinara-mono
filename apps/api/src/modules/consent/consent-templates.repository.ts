import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  consentTemplates,
  consentTemplateVersions,
  serviceConsentTemplates,
  services,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type ConsentTemplateRow = typeof consentTemplates.$inferSelect;
export type ConsentTemplateVersionRow = typeof consentTemplateVersions.$inferSelect;

export async function listTemplates(tx: Tx): Promise<ConsentTemplateRow[]> {
  return tx
    .select()
    .from(consentTemplates)
    .orderBy(asc(consentTemplates.archivedAt), asc(consentTemplates.name));
}

export async function findTemplate(tx: Tx, id: string): Promise<ConsentTemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.id, id))
    .limit(1);
  return row;
}

/**
 * Şablon satırını KİLİTLER.
 *
 * Yayın sürüm numarası üretip pointer taşıyor; ikinci bir eş zamanlı yayın
 * `(template_id, version)` UNIQUE'ine çarpardı (doğru sonuç, anlamsız hata).
 */
export async function lockTemplate(tx: Tx, id: string): Promise<ConsentTemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.id, id))
    .for('update')
    .limit(1);
  return row;
}

export async function insertTemplate(
  tx: Tx,
  values: { tenantId: string; name: string; validityDays: number | null },
): Promise<ConsentTemplateRow> {
  const [row] = await tx.insert(consentTemplates).values(values).returning();
  if (row === undefined) throw new Error('Onam şablonu oluşturulamadı');
  return row;
}

export async function updateTemplate(
  tx: Tx,
  id: string,
  patch: Partial<
    Pick<ConsentTemplateRow, 'name' | 'validityDays' | 'activeVersionId' | 'archivedAt'>
  >,
): Promise<ConsentTemplateRow | undefined> {
  const [row] = await tx
    .update(consentTemplates)
    .set(patch)
    .where(eq(consentTemplates.id, id))
    .returning();
  return row;
}

export async function findVersionsByIds(
  tx: Tx,
  ids: string[],
): Promise<ConsentTemplateVersionRow[]> {
  if (ids.length === 0) return [];
  return tx.select().from(consentTemplateVersions).where(inArray(consentTemplateVersions.id, ids));
}

export async function findVersion(
  tx: Tx,
  id: string,
): Promise<ConsentTemplateVersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(consentTemplateVersions)
    .where(eq(consentTemplateVersions.id, id))
    .limit(1);
  return row;
}

export async function listDrafts(
  tx: Tx,
  templateIds: string[],
): Promise<ConsentTemplateVersionRow[]> {
  if (templateIds.length === 0) return [];
  return tx
    .select()
    .from(consentTemplateVersions)
    .where(
      and(
        inArray(consentTemplateVersions.templateId, templateIds),
        eq(consentTemplateVersions.status, 'draft'),
      ),
    );
}

export async function findDraft(
  tx: Tx,
  templateId: string,
): Promise<ConsentTemplateVersionRow | undefined> {
  const [row] = await listDrafts(tx, [templateId]);
  return row;
}

export async function insertDraft(
  tx: Tx,
  values: { tenantId: string; templateId: string; body: string; sha256: string },
): Promise<ConsentTemplateVersionRow> {
  const [row] = await tx
    .insert(consentTemplateVersions)
    .values({ ...values, status: 'draft' })
    .returning();
  if (row === undefined) throw new Error('Onam şablonu taslağı oluşturulamadı');
  return row;
}

export async function updateDraft(
  tx: Tx,
  id: string,
  patch: { body: string; sha256: string },
): Promise<void> {
  await tx.update(consentTemplateVersions).set(patch).where(eq(consentTemplateVersions.id, id));
}

export async function nextVersion(tx: Tx, templateId: string): Promise<number> {
  const result = await tx.execute<{ next: number }>(sql`
    select coalesce(max(version), 0) + 1 as next
      from consent_template_versions
     where template_id = ${templateId}
  `);
  return Number(result.rows[0]?.next ?? 1);
}

export async function publishDraft(
  tx: Tx,
  id: string,
  values: { version: number; publishedBy: string | null },
): Promise<ConsentTemplateVersionRow | undefined> {
  const [row] = await tx
    .update(consentTemplateVersions)
    .set({ ...values, status: 'published', publishedAt: new Date() })
    .where(eq(consentTemplateVersions.id, id))
    .returning();
  return row;
}

export async function archiveVersion(tx: Tx, id: string): Promise<void> {
  await tx
    .update(consentTemplateVersions)
    .set({ status: 'archived' })
    .where(eq(consentTemplateVersions.id, id));
}

export async function listVersions(
  tx: Tx,
  templateId: string,
  limit: number,
): Promise<ConsentTemplateVersionRow[]> {
  return tx
    .select()
    .from(consentTemplateVersions)
    .where(eq(consentTemplateVersions.templateId, templateId))
    .orderBy(desc(consentTemplateVersions.version))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Hizmet bağlantısı
// ---------------------------------------------------------------------------

export async function listServiceLinks(
  tx: Tx,
): Promise<Array<{ serviceId: string; templateId: string }>> {
  return tx
    .select({
      serviceId: serviceConsentTemplates.serviceId,
      templateId: serviceConsentTemplates.templateId,
    })
    .from(serviceConsentTemplates)
    .innerJoin(services, eq(services.id, serviceConsentTemplates.serviceId))
    .where(isNull(services.deletedAt));
}

export async function listTemplateIdsForService(tx: Tx, serviceId: string): Promise<string[]> {
  const rows = await tx
    .select({ templateId: serviceConsentTemplates.templateId })
    .from(serviceConsentTemplates)
    .where(eq(serviceConsentTemplates.serviceId, serviceId));
  return rows.map((row) => row.templateId);
}

export async function findActiveService(
  tx: Tx,
  serviceId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, serviceId), isNull(services.deletedAt)))
    .limit(1);
  return row;
}

export async function replaceServiceLinks(
  tx: Tx,
  values: { tenantId: string; serviceId: string; templateIds: string[] },
): Promise<void> {
  await tx
    .delete(serviceConsentTemplates)
    .where(eq(serviceConsentTemplates.serviceId, values.serviceId));
  if (values.templateIds.length === 0) return;
  await tx.insert(serviceConsentTemplates).values(
    values.templateIds.map((templateId) => ({
      tenantId: values.tenantId,
      serviceId: values.serviceId,
      templateId,
    })),
  );
}
