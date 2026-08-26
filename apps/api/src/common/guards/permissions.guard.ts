import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type Permission } from '@klinara/shared';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { contextOf } from '../request-context';
import { hasPermission } from '../../modules/identity/principal';
import {
  BRANCH_SCOPE_KEY,
  PERMISSIONS_KEY,
  PLATFORM_ADMIN_KEY,
  PUBLIC_KEY,
  SELF_SERVICE_KEY,
} from '../decorators/auth.decorators';

/**
 * Yetki guard'ı — global, `AuthGuard`tan SONRA koşar.
 *
 * Kural: kimlik isteyen her uç ya bir izne (`@RequirePermission`) ya da açık
 * bir "kendi hesabı" işaretine (`@SelfService`) bağlıdır. İkisi de yoksa uç
 * KAPALIDIR — unutulmuş bir yetki kontrolü, sessizce açık bir uç yerine
 * gürültülü bir 403 üretir.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) === true) return true;
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets) === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    if (principal === undefined) throw AppError.unauthenticated();

    if (this.reflector.getAllAndOverride<boolean>(BRANCH_SCOPE_KEY, targets) === true) {
      const branchId = contextOf(request)?.branchId ?? null;
      if (branchId === null) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'X-Branch-Id başlığı zorunlu', {
          detail: 'Bu uç şube kapsamında çalışır.',
        });
      }
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);

    if (required === undefined || required.length === 0) {
      if (this.reflector.getAllAndOverride<boolean>(SELF_SERVICE_KEY, targets) === true) {
        return true;
      }
      // Geliştirici hatası: uca izin bağlanmamış. Fail-closed davranıyoruz.
      throw AppError.forbidden('Bu uç için yetki tanımı eksik');
    }

    const missing = required.filter((permission) => !hasPermission(principal, permission));
    if (missing.length > 0) {
      throw AppError.forbidden('Bu işlem için yetkiniz yok', {
        detail: `Gereken izin: ${missing.join(', ')}`,
      });
    }

    return true;
  }
}
