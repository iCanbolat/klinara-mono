import { desc, eq, sql } from 'drizzle-orm';
import { consentSignatures, consentTemplateVersions, users } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type ConsentSignatureRow = typeof consentSignatures.$inferSelect;

export interface SignatureWithCollector {
  signature: ConsentSignatureRow;
  collectorName: string | null;
}

export async function insertSignature(
  tx: Tx,
  values: typeof consentSignatures.$inferInsert,
): Promise<ConsentSignatureRow> {
  const [row] = await tx.insert(consentSignatures).values(values).returning();
  if (row === undefined) throw new Error('Onam imzası kaydedilemedi');
  return row;
}

export async function findSignature(
  tx: Tx,
  id: string,
): Promise<SignatureWithCollector | undefined> {
  const [row] = await tx
    .select({ signature: consentSignatures, collectorName: users.fullName })
    .from(consentSignatures)
    .leftJoin(users, eq(users.id, consentSignatures.collectedBy))
    .where(eq(consentSignatures.id, id))
    .limit(1);
  return row;
}

export async function listForCustomer(
  tx: Tx,
  customerId: string,
  limit: number,
): Promise<SignatureWithCollector[]> {
  return tx
    .select({ signature: consentSignatures, collectorName: users.fullName })
    .from(consentSignatures)
    .leftJoin(users, eq(users.id, consentSignatures.collectedBy))
    .where(eq(consentSignatures.customerId, customerId))
    .orderBy(desc(consentSignatures.signedAt))
    .limit(limit);
}

export async function listForAppointment(
  tx: Tx,
  appointmentId: string,
): Promise<SignatureWithCollector[]> {
  return tx
    .select({ signature: consentSignatures, collectorName: users.fullName })
    .from(consentSignatures)
    .leftJoin(users, eq(users.id, consentSignatures.collectedBy))
    .where(eq(consentSignatures.appointmentId, appointmentId))
    .orderBy(desc(consentSignatures.signedAt));
}

export async function findTemplateIdOfVersion(
  tx: Tx,
  versionId: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ templateId: consentTemplateVersions.templateId })
    .from(consentTemplateVersions)
    .where(eq(consentTemplateVersions.id, versionId))
    .limit(1);
  return row?.templateId;
}

/** PDF başlığı için klinik ve şube adı, şube saat dilimi. */
export async function findDocumentHeader(
  tx: Tx,
  branchId: string | null,
): Promise<{ clinicName: string; branchName: string | null; timeZone: string }> {
  const result = await tx.execute<{
    clinic_name: string;
    branch_name: string | null;
    timezone: string | null;
  }>(sql`
    select t.name as clinic_name, b.name as branch_name, b.timezone
      from tenants t
      left join branches b on b.id = ${branchId}::uuid and b.tenant_id = t.id
     where t.id = current_tenant_id()
     limit 1
  `);
  const row = result.rows[0];
  return {
    clinicName: row?.clinic_name ?? 'Klinik',
    branchName: row?.branch_name ?? null,
    timeZone: row?.timezone ?? 'Europe/Istanbul',
  };
}
