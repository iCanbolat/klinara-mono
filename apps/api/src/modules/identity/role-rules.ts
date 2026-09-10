import { ERROR_CODES, ROLE_BY_KEY, isRoleKey, type RoleKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import type { Principal } from './principal';

/**
 * Rol atamasının İKİ değişmez kuralı.
 *
 * Faz 1'de bunlar `InvitationsService`in içindeydi çünkü rol yalnız DAVETLE
 * atanıyordu. Üyelik ucu (`PUT /users/:id/memberships`) ikinci bir atama yolu
 * açıyor ve kuralın kopyalanması, iki yoldan birinin bir gün diğerinden
 * ayrışması demekti: yetki yükseltme koruması tam olarak unutulmayı kaldıramayan
 * türden bir kontrol.
 */

/** Kiracıya atanabilir bir rol mü — platform rolü ATANAMAZ. */
export function assertAssignableRole(roleKey: string): RoleKey {
  if (!isRoleKey(roleKey) || ROLE_BY_KEY[roleKey].scope === 'platform') {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Geçersiz rol', {
      extra: { errors: [{ path: 'roleKey', message: 'Tanımlı bir kiracı rolü olmalı' }] },
    });
  }
  return roleKey;
}

/** Principal'ın taşıdığı en geniş rolün rank'i. */
export function highestRank(principal: Principal): number {
  return Math.max(...principal.roles.map((role) => (isRoleKey(role) ? ROLE_BY_KEY[role].rank : 0)), 0);
}

/**
 * Kimse KENDİNDEN geniş yetkili bir rolü atayamaz — ve ALAMAZ da.
 *
 * İkinci yarı üyelik ucuyla birlikte gerekli oldu: şube yöneticisi işletme
 * sahibinin üyeliğini SİLEBİLSEYDİ, yetki yükseltme yerine yetki DÜŞÜRME ile
 * aynı sonuca varırdı — kendisinden yetkili tek kişiyi kliniğin dışına atmak.
 */
export function assertNoEscalation(roleKey: RoleKey, principal: Principal): void {
  if (ROLE_BY_KEY[roleKey].rank > highestRank(principal)) {
    throw new AppError(
      403,
      ERROR_CODES.ROLE_ESCALATION,
      'Kendinizden geniş yetkili bir rolü atayamaz veya kaldıramazsınız',
      { detail: `İlgili rol: ${ROLE_BY_KEY[roleKey].name}` },
    );
  }
}

/**
 * Rolün kapsamı ile şube alanının tutarlılığı.
 *
 * `memberships_validate_scope()` aynı kuralı DB'de de zorluyor; burada tekrar
 * edilmesinin sebebi hata mesajıdır — trigger'dan gelen `check_violation`
 * kullanıcıya hangi alanın yanlış olduğunu söyleyemez.
 */
export function assertRoleScope(roleKey: RoleKey, branchId: string | null | undefined): void {
  const role = ROLE_BY_KEY[roleKey];
  if (role.scope === 'branch' && (branchId === null || branchId === undefined)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu rol için şube seçilmeli', {
      extra: { errors: [{ path: 'branchId', message: 'Şube kapsamlı rol için zorunlu' }] },
    });
  }
  if (role.scope === 'tenant' && branchId !== null && branchId !== undefined) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu rol şubeye bağlanamaz', {
      extra: { errors: [{ path: 'branchId', message: 'Kiracı kapsamlı rol için gönderilmemeli' }] },
    });
  }
}
