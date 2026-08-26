import { and, count, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { loginAttempts, refreshTokens, sessions } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

/** Oturum, refresh token ve giriş denemesi kayıtları. */

export type SessionRow = typeof sessions.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export async function insertSession(
  tx: Tx,
  values: {
    userId: string;
    tenantId: string;
    authMethod: SessionRow['authMethod'];
    mfaMethod?: SessionRow['mfaMethod'];
    ip?: string | undefined;
    userAgent?: string | undefined;
    deviceLabel?: string | undefined;
    expiresAt: Date;
  },
): Promise<SessionRow> {
  const [row] = await tx.insert(sessions).values(values).returning();
  if (row === undefined) throw new Error('Oturum oluşturulamadı');
  return row;
}

export async function findSession(tx: Tx, id: string): Promise<SessionRow | undefined> {
  const [row] = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

export async function listActiveSessions(tx: Tx, userId: string): Promise<SessionRow[]> {
  return tx
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessions.lastUsedAt));
}

export async function touchSession(tx: Tx, id: string): Promise<void> {
  await tx.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, id));
}

export async function revokeSession(tx: Tx, id: string, reason: string): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

/** Kullanıcının TÜM oturumları (isteğe bağlı olarak biri hariç). */
export async function revokeAllSessions(
  tx: Tx,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId === undefined ? undefined : sql`${sessions.id} <> ${exceptSessionId}`,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Refresh token'lar
// ---------------------------------------------------------------------------

export async function insertRefreshToken(
  tx: Tx,
  values: { sessionId: string; tokenHash: string; expiresAt: Date; parentId?: string | undefined },
): Promise<RefreshTokenRow> {
  const [row] = await tx.insert(refreshTokens).values(values).returning();
  if (row === undefined) throw new Error('Yenileme token’ı oluşturulamadı');
  return row;
}

export async function findRefreshTokenByHash(
  tx: Tx,
  tokenHash: string,
): Promise<RefreshTokenRow | undefined> {
  const [row] = await tx
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/**
 * Token'ı "kullanıldı" işaretler — koşullu.
 *
 * `used_at is null` koşulu YARIŞ KOŞULUNU kapatır: aynı token'la gelen iki eş
 * zamanlı istekte yalnız biri satırı günceller, diğeri 0 satır görür ve
 * yeniden kullanım (reuse) olarak işlenir.
 */
export async function markRefreshTokenUsed(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(refreshTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
    .returning({ id: refreshTokens.id });
  return rows.length === 1;
}

// ---------------------------------------------------------------------------
// Giriş denemeleri
// ---------------------------------------------------------------------------

export async function recordLoginAttempt(
  tx: Tx,
  values: {
    identifier: string;
    userId?: string | undefined;
    succeeded: boolean;
    reason?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  },
): Promise<void> {
  await tx.insert(loginAttempts).values(values);
}

/** Pencere içindeki BAŞARISIZ deneme sayısı — kademeli kilidin girdisi. */
export async function countRecentFailures(
  tx: Tx,
  identifier: string,
  since: Date,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.createdAt, since),
      ),
    );
  return row?.value ?? 0;
}

/** Başarılı girişten sonra sayaç sıfırlanır: kilit ardışık hatalara bakar. */
export async function clearFailures(tx: Tx, identifier: string): Promise<void> {
  await tx
    .delete(loginAttempts)
    .where(and(eq(loginAttempts.identifier, identifier), eq(loginAttempts.succeeded, false)));
}
