import { and, eq, sql } from 'drizzle-orm';
import {
  bookingConsentAcceptances,
  bookingOtpChallenges,
  slotHolds,
  type SlotHoldRow,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

export type { SlotHoldRow };
export type OtpChallengeRow = typeof bookingOtpChallenges.$inferSelect;

export async function insertHold(
  tx: Tx,
  values: typeof slotHolds.$inferInsert,
): Promise<SlotHoldRow> {
  const [row] = await tx.insert(slotHolds).values(values).returning();
  if (row === undefined) throw new Error('Slot tutma yazılamadı');
  return row;
}

export async function findHoldByToken(
  tx: Tx,
  tokenHash: string,
): Promise<SlotHoldRow | undefined> {
  const [row] = await tx.select().from(slotHolds).where(eq(slotHolds.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function updateHold(
  tx: Tx,
  holdId: string,
  patch: Partial<typeof slotHolds.$inferInsert>,
): Promise<SlotHoldRow | undefined> {
  const [row] = await tx.update(slotHolds).set(patch).where(eq(slotHolds.id, holdId)).returning();
  return row;
}

/**
 * Aynı istemcinin aktif tutma sayısı (slot işgali sınırı).
 *
 * IP ya da doğrulanmış telefon — ikisinden biri eşleşiyorsa sayılır. Yalnız
 * IP'ye bakmak mobil şebekede aynı NAT arkasındaki gerçek müşterileri
 * engellerdi; yalnız telefona bakmak ise henüz OTP göndermemiş bir botu hiç
 * saymamak demekti.
 */
export async function countActiveHolds(
  tx: Tx,
  criteria: { clientIp: string | null; phone: string | null },
  now: Date,
): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
      from slot_holds
     where status = 'active'
       and expires_at > ${now.toISOString()}::timestamptz
       and (
         (${criteria.clientIp}::inet is not null and client_ip = ${criteria.clientIp}::inet)
         or (${criteria.phone}::text is not null and verified_phone = ${criteria.phone})
       )
  `);
  return result.rows[0]?.n ?? 0;
}

/** Süresi dolmuş tutmaları kapatır ve işgallerini serbest bırakır. */
export async function expireStaleHolds(tx: Tx, now: Date): Promise<number> {
  const result = await tx.execute<{ id: string }>(sql`
    with expired as (
      update slot_holds
         set status = 'expired', updated_at = now()
       where status = 'active' and expires_at <= ${now.toISOString()}::timestamptz
      returning id
    ), released as (
      update resource_bookings rb
         set active = false, updated_at = now()
        from expired e
       where rb.hold_id = e.id and rb.active
      returning rb.id
    )
    select id from expired
  `);
  return result.rows.length;
}

// --- OTP ---

export async function insertOtpChallenge(
  tx: Tx,
  values: typeof bookingOtpChallenges.$inferInsert,
): Promise<OtpChallengeRow> {
  const [row] = await tx.insert(bookingOtpChallenges).values(values).returning();
  if (row === undefined) throw new Error('Doğrulama kodu yazılamadı');
  return row;
}

export async function findOpenChallenge(
  tx: Tx,
  holdId: string,
): Promise<OtpChallengeRow | undefined> {
  const result = await tx.execute<Record<string, unknown>>(sql`
    select * from booking_otp_challenges
     where slot_hold_id = ${holdId} and consumed_at is null and burned_at is null
     limit 1
  `);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    bookingSiteId: row['booking_site_id'] as string,
    slotHoldId: row['slot_hold_id'] as string,
    phone: row['phone'] as string,
    codeHash: row['code_hash'] as string,
    attempts: Number(row['attempts']),
    expiresAt: new Date(row['expires_at'] as string),
    consumedAt: row['consumed_at'] === null ? null : new Date(row['consumed_at'] as string),
    burnedAt: row['burned_at'] === null ? null : new Date(row['burned_at'] as string),
    clientIp: (row['client_ip'] as string | null) ?? null,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  };
}

export async function updateChallenge(
  tx: Tx,
  challengeId: string,
  patch: Partial<typeof bookingOtpChallenges.$inferInsert>,
): Promise<void> {
  await tx.update(bookingOtpChallenges).set(patch).where(eq(bookingOtpChallenges.id, challengeId));
}

/** Açık kodu yakar — yeniden gönderimde eskisi geçersizleşmeli. */
export async function burnOpenChallenges(tx: Tx, holdId: string, now: Date): Promise<void> {
  await tx
    .update(bookingOtpChallenges)
    .set({ burnedAt: now })
    .where(
      and(
        eq(bookingOtpChallenges.slotHoldId, holdId),
        sql`consumed_at is null and burned_at is null`,
      ),
    );
}

export async function countChallengesSince(
  tx: Tx,
  criteria: { phone?: string; bookingSiteId?: string },
  since: Date,
): Promise<number> {
  const result = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
      from booking_otp_challenges
     where created_at >= ${since.toISOString()}::timestamptz
       and (${criteria.phone ?? null}::text is null or phone = ${criteria.phone ?? null})
       and (${criteria.bookingSiteId ?? null}::uuid is null
            or booking_site_id = ${criteria.bookingSiteId ?? null}::uuid)
  `);
  return result.rows[0]?.n ?? 0;
}

// --- Onam (Faz 7 stub'ı) ---

export async function insertConsentAcceptance(
  tx: Tx,
  values: typeof bookingConsentAcceptances.$inferInsert,
): Promise<void> {
  await tx.insert(bookingConsentAcceptances).values(values);
}
