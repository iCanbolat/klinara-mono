import type { Permission, RoleKey } from '@klinara/shared';

/**
 * Bir isteğin çözümlenmiş kimliği ve yetkileri.
 *
 * İzinler access token'da TAŞINMAZ. Sebebi basit: rol değişiminin ANINDA etkili
 * olması gerekir. Token'a gömülen izinler, token'ın ömrü boyunca (15 dk) eski
 * yetkiyi taşımaya devam ederdi — işten çıkarılan bir personelin yetkisi
 * çeyrek saat daha sürerdi.
 */
export interface Principal {
  userId: string;
  tenantId: string;
  sessionId: string;
  email: string;
  fullName: string;
  tokenVersion: number;
  roles: RoleKey[];
  permissions: ReadonlySet<string>;
  /** Şube kapsamlı üyeliklerin şubeleri. */
  branchIds: string[];
  /** Kiracı kapsamlı bir rolü var mı (owner/accountant) — tüm şubeleri kapsar. */
  tenantWide: boolean;
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  return principal.permissions.has(permission);
}

/** Kullanıcının belirtilen şubeye erişimi var mı. */
export function canAccessBranch(principal: Principal, branchId: string): boolean {
  return principal.tenantWide || principal.branchIds.includes(branchId);
}
