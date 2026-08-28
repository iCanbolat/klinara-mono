import { eq, sql } from 'drizzle-orm';
import {
  whatsappAccounts,
  whatsappContactWindows,
  whatsappTemplates,
  type WhatsAppTemplateStatus,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type WhatsAppAccountRow = typeof whatsappAccounts.$inferSelect;
export type WhatsAppTemplateRow = typeof whatsappTemplates.$inferSelect;

export async function findAccount(tx: Tx): Promise<WhatsAppAccountRow | undefined> {
  const [row] = await tx.select().from(whatsappAccounts).limit(1);
  return row;
}

export async function upsertAccount(
  tx: Tx,
  tenantId: string,
  values: {
    wabaId: string;
    phoneNumberId: string;
    businessPhone: string | null;
    accessTokenEncrypted: string;
    appSecretEncrypted: string | null;
    apiVersion: string;
  },
): Promise<WhatsAppAccountRow> {
  const [row] = await tx
    .insert(whatsappAccounts)
    .values({ tenantId, ...values, status: 'unconfigured' })
    .onConflictDoUpdate({
      target: whatsappAccounts.tenantId,
      set: {
        wabaId: values.wabaId,
        phoneNumberId: values.phoneNumberId,
        businessPhone: values.businessPhone,
        accessTokenEncrypted: values.accessTokenEncrypted,
        appSecretEncrypted: values.appSecretEncrypted,
        apiVersion: values.apiVersion,
        // Kimlik bilgisi değişti: doğrulanmış sayılmaz.
        status: 'unconfigured',
        lastVerifiedAt: null,
        lastError: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row as WhatsAppAccountRow;
}

export async function markVerified(
  tx: Tx,
  tenantId: string,
  outcome: { ok: boolean; error?: string },
): Promise<void> {
  await tx
    .update(whatsappAccounts)
    .set(
      outcome.ok
        ? { status: 'active', lastVerifiedAt: new Date(), lastError: null }
        : { status: 'error', lastError: outcome.error ?? null },
    )
    .where(eq(whatsappAccounts.tenantId, tenantId));
}

export async function listTemplates(tx: Tx): Promise<WhatsAppTemplateRow[]> {
  return tx.select().from(whatsappTemplates).orderBy(whatsappTemplates.name);
}

export async function replaceTemplates(
  tx: Tx,
  tenantId: string,
  rows: {
    name: string;
    language: string;
    category: string | null;
    status: WhatsAppTemplateStatus;
    bodyVariableCount: number;
    buttons: { type: string; text: string }[];
  }[],
): Promise<void> {
  // Yansıma TAZELENİR, birleştirilmez: Meta'da silinen bir template bizde
  // "onaylı" görünmeye devam ederse gönderim her seferinde kalıcı hata alır.
  await tx.delete(whatsappTemplates);
  if (rows.length === 0) return;

  await tx.insert(whatsappTemplates).values(
    rows.map((row) => ({
      tenantId,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      bodyVariableCount: row.bodyVariableCount,
      buttons: row.buttons,
      syncedAt: new Date(),
    })),
  );
}

/** 24 saatlik pencere açık mı — 8.3 doldurur, gönderim okur. */
export async function lastInboundAt(tx: Tx, phone: string): Promise<Date | undefined> {
  const [row] = await tx
    .select({ lastInboundAt: whatsappContactWindows.lastInboundAt })
    .from(whatsappContactWindows)
    .where(eq(whatsappContactWindows.phone, phone))
    .limit(1);
  return row?.lastInboundAt;
}
