import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { contextOf } from '../request-context';

/**
 * Platform yönetimi uçlarının koruması.
 *
 * Guard'lar NestJS'te pipe'lardan (yani gövde doğrulamasından) ÖNCE koşar.
 * Bu sıra kasıtlı ve önemlidir: aksi hâlde yetkisiz bir çağıran, alan bazlı
 * doğrulama hatalarından API şemasını keşfedebilirdi (403 yerine 400 + alan
 * listesi).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (contextOf(request)?.isPlatformAdmin !== true) {
      throw AppError.forbidden('Bu işlem platform yöneticisi yetkisi gerektirir');
    }
    return true;
  }
}
