import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import type { Permission } from '@klinara/shared';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';

export const PUBLIC_KEY = 'klinara:public';
export const SELF_SERVICE_KEY = 'klinara:selfService';
export const PERMISSIONS_KEY = 'klinara:permissions';
export const BRANCH_SCOPE_KEY = 'klinara:branchScope';
export const PLATFORM_ADMIN_KEY = 'klinara:platformAdmin';

/**
 * Kimlik doğrulaması GEREKTİRMEYEN uç.
 *
 * Kullanımı sayılıdır ve her biri kasıtlıdır: giriş, token yenileme, davet
 * kabulü, parola sıfırlama ve (Faz 9'da) online randevu uçları. Bunun dışındaki
 * her uç kimlik ister — varsayılan kapalıdır, açmak açık bir karardır.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Kimlik doğrulaması gerektiren ama İZİN gerektirmeyen uç.
 *
 * Kullanıcının kendi hesabı üzerindeki işlemleri: `/me`, kendi oturumları,
 * kendi 2FA'sı, kendi telefonu, kendi passkey'leri. Bir izin tanımlamak
 * anlamsız olurdu — herkes kendi hesabını yönetebilmeli.
 */
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

/**
 * Ucun gerektirdiği izin(ler). Birden çok verilirse HEPSİ aranır.
 *
 * Yetki DAİMA izin üzerinden kontrol edilir, rol adına göre değil: rol bir izin
 * demetidir ve kiracıya göre değişebilir.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * `X-Branch-Id` başlığını ZORUNLU kılar ve kullanıcının o şubede üyeliğini arar.
 *
 * Kiracı kapsamlı roller (owner, accountant) tüm şubeleri kapsar.
 */
export const RequireBranchScope = () => SetMetadata(BRANCH_SCOPE_KEY, true);

/** Platform yönetimi ucu — kiracı JWT'si değil, platform token'ı ile korunur. */
export const PlatformAdminOnly = () =>
  applyDecorators(SetMetadata(PLATFORM_ADMIN_KEY, true), UseGuards(PlatformAdminGuard));
