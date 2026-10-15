import { sql } from 'drizzle-orm';
import type { Tx } from '../../database/tenant-tx';
import type { PushEnvironment, PushPlatform } from '../../lib/push/push.types';

// `type`, `interface` değil: `tx.execute<T>` index imzası olan bir tip istiyor.
export type PushRecipientRow = {
  id: string;
  platform: PushPlatform;
  environment: PushEnvironment;
  token: string;
};

/**
 * Kayıt `security definer` fonksiyondan geçer (migration 0054): anahtar başka
 * bir kullanıcıya aitse onun satırı silinmeli ve RLS o satırı göstermiyor.
 */
export async function register(
  tx: Tx,
  input: { sessionId: string; platform: PushPlatform; environment: PushEnvironment; token: string },
): Promise<void> {
  await tx.execute(sql`
    select register_push_device(
      ${input.sessionId}::uuid,
      ${input.platform}::push_platform,
      ${input.environment}::push_environment,
      ${input.token}
    )
  `);
}

/** Oturumun cihazı — RLS zaten yalnız kullanıcının kendi satırlarını gösteriyor. */
export async function removeForSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.execute(sql`delete from push_devices where session_id = ${sessionId}::uuid`);
}

export async function recipients(tx: Tx, branchId: string | null): Promise<PushRecipientRow[]> {
  const result = await tx.execute<PushRecipientRow>(sql`
    select id, platform, environment, token from push_recipients(${branchId}::uuid)
  `);
  return result.rows;
}

export async function forget(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`
    select forget_push_devices(array[${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]::uuid[])
  `);
}
