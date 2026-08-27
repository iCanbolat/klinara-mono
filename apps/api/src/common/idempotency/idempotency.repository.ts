import { and, eq, lt, sql } from 'drizzle-orm';
import { idempotencyKeys } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export interface IdempotencyRecord {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  lockedAt: Date | null;
}

/**
 * Anahtarı "kilitli" olarak yazmayı dener.
 *
 * `on conflict do nothing` + `returning`: satır yazılabildiyse bu isteğin
 * BİRİNCİ olduğu, yazılamadıysa aynı anahtarın daha önce görüldüğü anlaşılır.
 * Ayrı bir "önce bak, sonra yaz" adımı YOK — iki eş zamanlı istek arasında
 * yarış bırakırdı.
 */
export async function tryClaim(
  tx: Tx,
  tenantId: string,
  key: string,
  requestHash: string,
  ttlHours: number,
): Promise<boolean> {
  const result = await tx.execute(sql`
    insert into idempotency_keys (tenant_id, key, request_hash, locked_at, expires_at)
    values (${tenantId}, ${key}, ${requestHash}, now(),
            now() + make_interval(hours => ${ttlHours}))
    on conflict (tenant_id, key) do nothing
    returning key
  `);
  return result.rows.length > 0;
}

export async function findRecord(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<IdempotencyRecord | undefined> {
  const [row] = await tx
    .select({
      requestHash: idempotencyKeys.requestHash,
      responseStatus: idempotencyKeys.responseStatus,
      responseBody: idempotencyKeys.responseBody,
      lockedAt: idempotencyKeys.lockedAt,
    })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)))
    .limit(1);
  return row;
}

export async function storeResponse(
  tx: Tx,
  tenantId: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ responseStatus: status, responseBody: body, lockedAt: null })
    .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)));
}

/** İstek başarısız olursa kilidi bırakır: aynı anahtar tekrar denenebilmeli. */
export async function release(tx: Tx, tenantId: string, key: string): Promise<void> {
  await tx
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)));
}

export async function purgeExpired(tx: Tx): Promise<void> {
  await tx.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
}
