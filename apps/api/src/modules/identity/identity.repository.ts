import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  memberships,
  rolePermissions,
  roles,
  sessions,
  tenants,
  users,
} from '../../database/schema';
import type { Tx } from '../../database/tenant-tx';
import { definedValues, hasUpdates, type Updatable } from '../../database/updates';

/**
 * Kimlik repository'si.
 *
 * KURAL (Faz 0'dan beri aynı): her fonksiyon ilk parametre olarak `tx` alır.
 * Kimlik sorgularının bir kısmı KİRACI context'i olmadan koşar; o durumda
 * çağıran `TenantTxService.runAsAuth()` kullanır ve `app.auth_flow` bayrağı
 * kimlik tablolarının politikalarını açar.
 */


export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;

export interface MembershipSummary {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  branchId: string | null;
  roleKey: string;
  roleScope: string;
  roleRank: number;
}

// ---------------------------------------------------------------------------
// Kullanıcılar
// ---------------------------------------------------------------------------

export async function findUserById(tx: Tx, id: string): Promise<UserRow | undefined> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

export async function findUserByEmail(tx: Tx, email: string): Promise<UserRow | undefined> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

/**
 * Telefonla giriş: YALNIZ doğrulanmış numara kabul edilir.
 *
 * Doğrulanmamış numara kimlik değil, sadece bir iletişim alanıdır. Aksi hâlde
 * başkasının numarasını profiline yazan biri, o numarayı giriş tanımlayıcısı
 * hâline getirirdi.
 */
export async function findUserByVerifiedPhone(tx: Tx, phone: string): Promise<UserRow | undefined> {
  const [row] = await tx
    .select()
    .from(users)
    .where(
      and(
        eq(users.phone, phone),
        sql`${users.phoneVerifiedAt} is not null`,
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

/** Doğrulanmamış da olsa numarayı taşıyan başka bir hesap var mı. */
export async function findUserByPhoneAny(tx: Tx, phone: string): Promise<UserRow | undefined> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

export async function insertUser(
  tx: Tx,
  values: {
    email: string;
    fullName: string;
    passwordHash?: string | undefined;
    locale?: string | undefined;
  },
): Promise<UserRow> {
  const [row] = await tx.insert(users).values(values).returning();
  if (row === undefined) throw new Error('Kullanıcı oluşturulamadı');
  return row;
}

export async function updateUser(
  tx: Tx,
  id: string,
  values: Updatable<
    Pick<
      UserRow,
      | 'fullName'
      | 'locale'
      | 'isActive'
      | 'passwordHash'
      | 'phone'
      | 'phoneVerifiedAt'
      | 'lastLoginAt'
    >
  >,
): Promise<UserRow | undefined> {
  const patch = definedValues(values);
  if (!hasUpdates(patch)) return findUserById(tx, id);
  const [row] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
  return row;
}

/**
 * Token sürümünü artırır — elindeki TÜM access token'ları geçersiz kılar.
 *
 * Parola değişimi ve `logout-all` bunu çağırır. Access token stateless olduğu
 * için tek iptal yolu budur; yetki çözümlemesi her istekte sürümü karşılaştırır.
 */
export async function bumpTokenVersion(tx: Tx, id: string): Promise<number> {
  const [row] = await tx
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, id))
    .returning({ tokenVersion: users.tokenVersion });
  return row?.tokenVersion ?? 1;
}

/** Kiracıdaki kullanıcılar — RLS zaten kiracıyla sınırlar, üyelik join'i sıralama içindir. */
export async function listTenantUsers(tx: Tx): Promise<UserRow[]> {
  const rows = await tx
    .selectDistinctOn([users.id], { user: users })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(isNull(users.deletedAt), isNull(memberships.deletedAt)));
  return rows.map((row) => row.user).sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr'));
}

/** Kiracı adı — davet önizlemesinde gösterilir (context o kiracıya daraltılmış olarak). */
export async function findTenantName(tx: Tx, tenantId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ name: tenants.name })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
    .limit(1);
  return row?.name;
}

// ---------------------------------------------------------------------------
// Üyelikler
// ---------------------------------------------------------------------------

export async function listMembershipsForUser(tx: Tx, userId: string): Promise<MembershipSummary[]> {
  return tx
    .select({
      id: memberships.id,
      tenantId: memberships.tenantId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      branchId: memberships.branchId,
      roleKey: memberships.roleKey,
      roleScope: roles.scope,
      roleRank: roles.rank,
    })
    .from(memberships)
    .innerJoin(roles, eq(roles.key, memberships.roleKey))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.isActive, true),
        isNull(memberships.deletedAt),
        isNull(tenants.deletedAt),
      ),
    )
    .orderBy(asc(tenants.name));
}

export async function listMembershipsInTenant(
  tx: Tx,
  userId: string,
  tenantId: string,
): Promise<MembershipRow[]> {
  return tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.tenantId, tenantId),
        eq(memberships.isActive, true),
        isNull(memberships.deletedAt),
      ),
    );
}

export async function insertMembership(
  tx: Tx,
  values: { tenantId: string; userId: string; branchId?: string | null; roleKey: string },
): Promise<MembershipRow> {
  const [row] = await tx
    .insert(memberships)
    .values(values)
    .onConflictDoUpdate({
      target: [memberships.tenantId, memberships.userId, memberships.branchId, memberships.roleKey],
      set: { isActive: true, deletedAt: null },
    })
    .returning();
  if (row === undefined) throw new Error('Üyelik oluşturulamadı');
  return row;
}

// ---------------------------------------------------------------------------
// Yetki çözümlemesi
// ---------------------------------------------------------------------------

export interface PrincipalRow {
  user: UserRow | undefined;
  memberships: { roleKey: string; branchId: string | null }[];
  permissions: string[];
}

export async function resolvePrincipal(
  tx: Tx,
  userId: string,
  tenantId: string,
): Promise<PrincipalRow> {
  const user = await findUserById(tx, userId);
  if (user === undefined) return { user: undefined, memberships: [], permissions: [] };

  const rows = await tx
    .select({ roleKey: memberships.roleKey, branchId: memberships.branchId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.tenantId, tenantId),
        eq(memberships.isActive, true),
        isNull(memberships.deletedAt),
      ),
    );

  if (rows.length === 0) return { user, memberships: [], permissions: [] };

  const roleKeys = [...new Set(rows.map((row) => row.roleKey))];
  const permissionRows = await tx
    .selectDistinct({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleKey, roleKeys));

  return { user, memberships: rows, permissions: permissionRows.map((row) => row.key) };
}

/** Oturum yaşıyor mu: iptal edilmemiş ve süresi dolmamış. */
export async function findActiveSession(
  tx: Tx,
  sessionId: string,
  userId: string,
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row;
}
