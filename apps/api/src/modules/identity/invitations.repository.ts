import { and, desc, eq, isNull } from 'drizzle-orm';
import { invitations, passwordResetTokens } from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';

/** Davet ve parola sıfırlama token'ları — ikisi de tek kullanımlık ve süreli. */

export type InvitationRow = typeof invitations.$inferSelect;
export type PasswordResetRow = typeof passwordResetTokens.$inferSelect;

export async function insertInvitation(
  tx: Tx,
  values: {
    tenantId: string;
    branchId?: string | null;
    roleKey: string;
    email: string;
    fullName?: string | undefined;
    tokenHash: string;
    invitedByUserId?: string | undefined;
    expiresAt: Date;
  },
): Promise<InvitationRow> {
  const [row] = await tx.insert(invitations).values(values).returning();
  if (row === undefined) throw new Error('Davet oluşturulamadı');
  return row;
}

export async function findInvitationByHash(
  tx: Tx,
  tokenHash: string,
): Promise<InvitationRow | undefined> {
  const [row] = await tx
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function findPendingInvitation(
  tx: Tx,
  tenantId: string,
  email: string,
): Promise<InvitationRow | undefined> {
  const [row] = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, tenantId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function listInvitations(tx: Tx): Promise<InvitationRow[]> {
  return tx.select().from(invitations).orderBy(desc(invitations.createdAt));
}

/** Daveti kabul edilmiş işaretler — koşullu, yani ikinci kabul 0 satır günceller. */
export async function acceptInvitation(tx: Tx, id: string, userId: string): Promise<boolean> {
  const rows = await tx
    .update(invitations)
    .set({ acceptedAt: new Date(), acceptedUserId: userId })
    .where(
      and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
    )
    .returning({ id: invitations.id });
  return rows.length === 1;
}

export async function revokeInvitation(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
    )
    .returning({ id: invitations.id });
  return rows.length === 1;
}

// ---------------------------------------------------------------------------
// Parola sıfırlama
// ---------------------------------------------------------------------------

export async function insertPasswordReset(
  tx: Tx,
  values: { userId: string; tokenHash: string; expiresAt: Date; requestedIp?: string | undefined },
): Promise<PasswordResetRow> {
  const [row] = await tx.insert(passwordResetTokens).values(values).returning();
  if (row === undefined) throw new Error('Sıfırlama token’ı oluşturulamadı');
  return row;
}

export async function findPasswordResetByHash(
  tx: Tx,
  tokenHash: string,
): Promise<PasswordResetRow | undefined> {
  const [row] = await tx
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function consumePasswordReset(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });
  return rows.length === 1;
}
