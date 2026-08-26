import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  phoneVerificationCodes,
  userBackupCodes,
  userPasskeys,
  userTotpSecrets,
  webauthnChallenges,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

/** TOTP, yedek kod, telefon doğrulama kodu ve passkey kayıtları. */

export type TotpSecretRow = typeof userTotpSecrets.$inferSelect;
export type PhoneCodeRow = typeof phoneVerificationCodes.$inferSelect;
export type PasskeyRow = typeof userPasskeys.$inferSelect;

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

export async function findTotpSecret(tx: Tx, userId: string): Promise<TotpSecretRow | undefined> {
  const [row] = await tx
    .select()
    .from(userTotpSecrets)
    .where(eq(userTotpSecrets.userId, userId))
    .limit(1);
  return row;
}

export async function upsertTotpSecret(
  tx: Tx,
  values: { userId: string; secretEncrypted: string; keyId: string },
): Promise<TotpSecretRow> {
  const [row] = await tx
    .insert(userTotpSecrets)
    .values(values)
    .onConflictDoUpdate({
      target: userTotpSecrets.userId,
      // Yeniden kurulum eski sırrı ve onayı SIFIRLAR: yarım kalmış bir kurulum
      // eski doğrulanmış sırrı geçerli bırakmamalı.
      set: { ...values, confirmedAt: null, lastUsedStep: null },
    })
    .returning();
  if (row === undefined) throw new Error('TOTP sırrı kaydedilemedi');
  return row;
}

export async function confirmTotpSecret(tx: Tx, userId: string, step: number): Promise<void> {
  await tx
    .update(userTotpSecrets)
    .set({ confirmedAt: new Date(), lastUsedStep: step })
    .where(eq(userTotpSecrets.userId, userId));
}

/**
 * Kullanılan TOTP adımını kaydeder — replay koruması.
 *
 * `last_used_step < step` koşulu şarttır: aynı kodun ikinci kez gelmesi 0 satır
 * günceller ve çağıran bunu reddeder. Kod 30 saniye geçerli olduğu için bu
 * kontrol olmadan ağı dinleyen biri kodu aynı pencerede yeniden kullanabilirdi.
 */
export async function consumeTotpStep(tx: Tx, userId: string, step: number): Promise<boolean> {
  const rows = await tx
    .update(userTotpSecrets)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(userTotpSecrets.userId, userId),
        sql`(${userTotpSecrets.lastUsedStep} is null or ${userTotpSecrets.lastUsedStep} < ${step})`,
      ),
    )
    .returning({ userId: userTotpSecrets.userId });
  return rows.length === 1;
}

export async function deleteTotpSecret(tx: Tx, userId: string): Promise<void> {
  await tx.delete(userTotpSecrets).where(eq(userTotpSecrets.userId, userId));
}

// ---------------------------------------------------------------------------
// Yedek kodlar
// ---------------------------------------------------------------------------

export async function replaceBackupCodes(
  tx: Tx,
  userId: string,
  codeHashes: string[],
): Promise<void> {
  await tx.delete(userBackupCodes).where(eq(userBackupCodes.userId, userId));
  if (codeHashes.length === 0) return;
  await tx.insert(userBackupCodes).values(codeHashes.map((codeHash) => ({ userId, codeHash })));
}

/** Yedek kodu tüketir; tek kullanımlıktır (koşullu update ile yarışa kapalı). */
export async function consumeBackupCode(
  tx: Tx,
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const rows = await tx
    .update(userBackupCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(userBackupCodes.userId, userId),
        eq(userBackupCodes.codeHash, codeHash),
        isNull(userBackupCodes.usedAt),
      ),
    )
    .returning({ id: userBackupCodes.id });
  return rows.length === 1;
}

export async function countUnusedBackupCodes(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .select({ id: userBackupCodes.id })
    .from(userBackupCodes)
    .where(and(eq(userBackupCodes.userId, userId), isNull(userBackupCodes.usedAt)));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Telefon doğrulama kodları
// ---------------------------------------------------------------------------

export async function insertPhoneCode(
  tx: Tx,
  values: {
    userId: string;
    phone: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
  },
): Promise<PhoneCodeRow> {
  const [row] = await tx.insert(phoneVerificationCodes).values(values).returning();
  if (row === undefined) throw new Error('Doğrulama kodu kaydedilemedi');
  return row;
}

export async function findActivePhoneCode(
  tx: Tx,
  userId: string,
): Promise<PhoneCodeRow | undefined> {
  const [row] = await tx
    .select()
    .from(phoneVerificationCodes)
    .where(
      and(
        eq(phoneVerificationCodes.userId, userId),
        isNull(phoneVerificationCodes.consumedAt),
        isNull(phoneVerificationCodes.invalidatedAt),
      ),
    )
    .orderBy(desc(phoneVerificationCodes.createdAt))
    .limit(1);
  return row;
}

/** Son gönderim zamanı — SMS hız sınırının girdisi. */
export async function findLastPhoneCode(tx: Tx, userId: string): Promise<PhoneCodeRow | undefined> {
  const [row] = await tx
    .select()
    .from(phoneVerificationCodes)
    .where(eq(phoneVerificationCodes.userId, userId))
    .orderBy(desc(phoneVerificationCodes.createdAt))
    .limit(1);
  return row;
}

/** Belirli bir andan bu yana gönderilen kod sayısı — saatlik SMS tavanı. */
export async function countPhoneCodesSince(tx: Tx, userId: string, since: Date): Promise<number> {
  const rows = await tx
    .select({ id: phoneVerificationCodes.id })
    .from(phoneVerificationCodes)
    .where(
      and(eq(phoneVerificationCodes.userId, userId), gt(phoneVerificationCodes.createdAt, since)),
    );
  return rows.length;
}

export async function incrementPhoneCodeAttempts(tx: Tx, id: string): Promise<number> {
  const [row] = await tx
    .update(phoneVerificationCodes)
    .set({ attempts: sql`${phoneVerificationCodes.attempts} + 1` })
    .where(eq(phoneVerificationCodes.id, id))
    .returning({ attempts: phoneVerificationCodes.attempts });
  return row?.attempts ?? 0;
}

export async function invalidatePhoneCodes(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(phoneVerificationCodes)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(phoneVerificationCodes.userId, userId),
        isNull(phoneVerificationCodes.consumedAt),
        isNull(phoneVerificationCodes.invalidatedAt),
      ),
    );
}

export async function consumePhoneCode(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(phoneVerificationCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(phoneVerificationCodes.id, id), isNull(phoneVerificationCodes.consumedAt)))
    .returning({ id: phoneVerificationCodes.id });
  return rows.length === 1;
}

// ---------------------------------------------------------------------------
// Passkey ve challenge
// ---------------------------------------------------------------------------

export async function insertChallenge(
  tx: Tx,
  values: {
    challenge: string;
    userId?: string | undefined;
    purpose: 'registration' | 'authentication';
    expiresAt: Date;
  },
): Promise<void> {
  await tx.insert(webauthnChallenges).values(values);
}

/**
 * Challenge'ı TEK KULLANIMLIK olarak tüketir.
 *
 * Koşullu update: `consumed_at is null` ve süresi dolmamış. Aynı challenge iki
 * kez doğrulanamaz — tekrar (replay) saldırısına kapalı.
 */
export async function consumeChallenge(
  tx: Tx,
  challenge: string,
  purpose: 'registration' | 'authentication',
): Promise<{ userId: string | null } | undefined> {
  const rows = await tx
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        eq(webauthnChallenges.purpose, purpose),
        isNull(webauthnChallenges.consumedAt),
        gt(webauthnChallenges.expiresAt, new Date()),
      ),
    )
    .returning({ userId: webauthnChallenges.userId });
  return rows[0];
}

export async function insertPasskey(
  tx: Tx,
  values: {
    userId: string;
    credentialId: string;
    publicKey: Buffer;
    signCount: number;
    transports?: string[] | undefined;
    aaguid?: string | undefined;
    backedUp: boolean;
    deviceLabel: string;
  },
): Promise<PasskeyRow> {
  const [row] = await tx.insert(userPasskeys).values(values).returning();
  if (row === undefined) throw new Error('Passkey kaydedilemedi');
  return row;
}

export async function findPasskeyByCredentialId(
  tx: Tx,
  credentialId: string,
): Promise<PasskeyRow | undefined> {
  const [row] = await tx
    .select()
    .from(userPasskeys)
    .where(eq(userPasskeys.credentialId, credentialId))
    .limit(1);
  return row;
}

export async function listPasskeys(tx: Tx, userId: string): Promise<PasskeyRow[]> {
  return tx
    .select()
    .from(userPasskeys)
    .where(eq(userPasskeys.userId, userId))
    .orderBy(desc(userPasskeys.createdAt));
}

export async function findPasskeyById(
  tx: Tx,
  id: string,
  userId: string,
): Promise<PasskeyRow | undefined> {
  const [row] = await tx
    .select()
    .from(userPasskeys)
    .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
    .limit(1);
  return row;
}

export async function updatePasskeyUsage(tx: Tx, id: string, signCount: number): Promise<void> {
  await tx
    .update(userPasskeys)
    .set({ signCount, lastUsedAt: new Date() })
    .where(eq(userPasskeys.id, id));
}

export async function renamePasskey(
  tx: Tx,
  id: string,
  userId: string,
  deviceLabel: string,
): Promise<PasskeyRow | undefined> {
  const [row] = await tx
    .update(userPasskeys)
    .set({ deviceLabel })
    .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
    .returning();
  return row;
}

export async function deletePasskey(tx: Tx, id: string, userId: string): Promise<boolean> {
  const rows = await tx
    .delete(userPasskeys)
    .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
    .returning({ id: userPasskeys.id });
  return rows.length === 1;
}
