import {
  ASSIGNABLE_ROLES,
  ROLE_BY_KEY,
  isRoleKey,
  type Me,
  type Membership,
  type MembershipInput,
  type RoleKey,
  type StaffProfile,
} from '@klinara/shared';

/**
 * Rol/şube düzenleyicisinin SAF kuralları.
 *
 * ⚠️ Bunlar YETKİ KAPISI DEĞİL — sunucu (`role-rules.ts`,
 * `users.service.replaceMemberships`) aynı kuralları zorluyor. Burada
 * tekrarlanmalarının tek sebebi, kullanıcıya kaydedemeyeceği bir değişikliği
 * baştan yaptırmamak ve NEDENİNİ satırın yanında söylemek.
 *
 * Sunucunun kuralları:
 *   1. Kimse kendi rollerine dokunamaz.
 *   2. Kendi en yüksek rütbesinden YÜKSEK bir rolü ne atayabilir ne kaldırabilir.
 *   3. `PUT` TAM DEĞİŞTİRME ve gönderilen HER şube kimliği `assertInput`tan
 *      geçiyor — yani erişemediğim bir şubedeki üyeliği "dokunmadan bırakmak"
 *      bile 403. Böyle bir kullanıcının rol kümesi bu oturumda düzenlenemez.
 *   4. Şube kapsamlı rol şube İSTER, kiracı kapsamlı rol şube ALMAZ.
 */

export interface MembershipDraft {
  /** İstemci anahtarı — sunucu kimliği değil; yeni satırlarda uydurma. */
  key: string;
  roleKey: string;
  /** `null` = kiracı kapsamlı rol. */
  branchId: string | null;
}

export type MembershipLock = 'self' | 'rank' | 'branch' | null;

export function highestRank(me: Pick<Me, 'roles'>): number {
  return me.roles.reduce(
    (highest, role) => (isRoleKey(role) ? Math.max(highest, ROLE_BY_KEY[role].rank) : highest),
    0,
  );
}

/** Bu kullanıcının atayabileceği roller, yetki sırasına göre (yüksekten düşüğe). */
export function assignableRolesFor(me: Pick<Me, 'roles'>): RoleKey[] {
  const mine = highestRank(me);
  return ASSIGNABLE_ROLES.filter((role) => ROLE_BY_KEY[role].rank <= mine).sort(
    (left, right) => ROLE_BY_KEY[right].rank - ROLE_BY_KEY[left].rank,
  );
}

export function isTenantScoped(roleKey: string): boolean {
  return isRoleKey(roleKey) && ROLE_BY_KEY[roleKey].scope === 'tenant';
}

export function roleName(roleKey: string): string {
  return isRoleKey(roleKey) ? ROLE_BY_KEY[roleKey].name : roleKey;
}

/** Tek bir satır neden kilitli? `null` = düzenlenebilir. */
export function membershipLock(
  me: Pick<Me, 'roles' | 'branchIds' | 'tenantWide'>,
  row: Pick<MembershipDraft, 'roleKey' | 'branchId'>,
): MembershipLock {
  if (!isRoleKey(row.roleKey) || ROLE_BY_KEY[row.roleKey].rank > highestRank(me)) return 'rank';
  if (row.branchId !== null && !me.tenantWide && !me.branchIds.includes(row.branchId)) {
    return 'branch';
  }
  return null;
}

/**
 * Kullanıcının rol kümesi bu oturumda DÜZENLENEBİLİR mi? Tam değiştirme
 * yüzünden tek bir erişilemeyen şube satırı tüm kümeyi kilitliyor (kural 3);
 * rütbe kilidi ise yalnız o satırı (satır olduğu gibi geri gönderilir).
 */
export function editorLock(
  me: Pick<Me, 'roles' | 'branchIds' | 'tenantWide'> & { user: Pick<Me['user'], 'id'> },
  userId: string,
  rows: readonly Pick<MembershipDraft, 'roleKey' | 'branchId'>[],
): 'self' | 'branch' | null {
  if (me.user.id === userId) return 'self';
  if (rows.some((row) => membershipLock(me, row) === 'branch')) return 'branch';
  return null;
}

export type MembershipIssue = 'branchRequired' | 'duplicate';

/** Satır anahtarı → sorun. Boş nesne = kaydedilebilir. */
export function validateMemberships(
  rows: readonly MembershipDraft[],
): Record<string, MembershipIssue> {
  const issues: Record<string, MembershipIssue> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isTenantScoped(row.roleKey) && row.branchId === null) {
      issues[row.key] = 'branchRequired';
      continue;
    }
    const identity = `${row.roleKey}|${row.branchId ?? ''}`;
    if (seen.has(identity)) issues[row.key] = 'duplicate';
    seen.add(identity);
  }
  return issues;
}

export function toDrafts(memberships: readonly Membership[]): MembershipDraft[] {
  return memberships.map((membership) => ({
    key: membership.id,
    roleKey: membership.roleKey,
    branchId: membership.branchId,
  }));
}

export function toInputs(rows: readonly MembershipDraft[]): MembershipInput[] {
  return rows.map((row) =>
    row.branchId === null || isTenantScoped(row.roleKey)
      ? { roleKey: row.roleKey }
      : { roleKey: row.roleKey, branchId: row.branchId },
  );
}

/** Sıradan bağımsız karşılaştırma — "kaydedilmemiş değişiklik var mı". */
export function sameMemberships(
  left: readonly Pick<MembershipDraft, 'roleKey' | 'branchId'>[],
  right: readonly Pick<MembershipDraft, 'roleKey' | 'branchId'>[],
): boolean {
  const keys = (rows: typeof left): string =>
    rows
      .map((row) => `${row.roleKey}|${row.branchId ?? ''}`)
      .sort()
      .join(',');
  return keys(left) === keys(right);
}

/**
 * Personelin çalıştığı şubeler: aktif şube üyelikleri + ana şube. Sunucunun
 * `GET staff?branchId=` süzgeciyle AYNI kural.
 */
export function staffBranchIds(
  profile: Pick<StaffProfile, 'branchIds' | 'primaryBranchId'>,
): string[] {
  const ids = new Set(profile.branchIds);
  if (profile.primaryBranchId !== null) ids.add(profile.primaryBranchId);
  return [...ids];
}
