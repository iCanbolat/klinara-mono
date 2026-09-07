import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PlatformAccessLogService } from '../platform/platform-access-log.service';
import { AppError } from '../errors/app-error';
import { contextOf, requestIdOf } from '../request-context';
import { sanitizeUrl } from '../../observability/redaction';

/** Destek gerekçesinin taşındığı başlık. */
export const SUPPORT_REASON_HEADER = 'x-support-reason';

/** Gerekçe en az bu kadar anlamlı olmalı — "x" bir gerekçe değildir. */
const MIN_REASON_LENGTH = 8;
const MAX_REASON_LENGTH = 500;

/**
 * Platform yönetimi uçlarının koruması.
 *
 * Guard'lar NestJS'te pipe'lardan (yani gövde doğrulamasından) ÖNCE koşar.
 * Bu sıra kasıtlı ve önemlidir: aksi hâlde yetkisiz bir çağıran, alan bazlı
 * doğrulama hatalarından API şemasını keşfedebilirdi (403 yerine 400 + alan
 * listesi).
 *
 * Batch 10.3 ile iki koşul eklendi ve ikisi de kabul kriteridir:
 *
 *   1. **Süreli.** Token'ın `PLATFORM_ADMIN_TOKEN_NOT_AFTER` tarihi geçtiyse
 *      erişim yoktur. Kiracı-üstü bir anahtarın süresiz olması, bir kez
 *      sızdığında sonsuza kadar geçerli olması demekti.
 *   2. **Gerekçeli ve kayıtlı.** Her çağrı `platform_access_log`a yazılır ve
 *      `X-Support-Reason` başlığı zorunludur. Kayıt yazılamazsa istek de
 *      geçmez (bkz. `PlatformAccessLogService`).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly accessLog: PlatformAccessLogService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.platformTokenExpired === true) {
      throw AppError.forbidden('Destek erişiminin süresi doldu', {
        detail: 'Platform token’ı yenilenmeli (bkz. sır rotasyonu prosedürü).',
      });
    }

    if (contextOf(request)?.isPlatformAdmin !== true) {
      throw AppError.forbidden('Bu işlem platform yöneticisi yetkisi gerektirir');
    }

    const reason = PlatformAdminGuard.reasonOf(request);

    await this.accessLog.record({
      requestId: requestIdOf(request) || null,
      method: request.method,
      path: sanitizeUrl(request.originalUrl),
      reason,
      clientIp: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      tokenExpiresAt: this.config.get('PLATFORM_ADMIN_TOKEN_NOT_AFTER', { infer: true }) ?? null,
    });

    return true;
  }

  private static reasonOf(request: Request): string {
    const raw = request.headers[SUPPORT_REASON_HEADER];
    const reason = typeof raw === 'string' ? raw.trim() : '';
    if (reason.length < MIN_REASON_LENGTH) {
      throw AppError.forbidden('Destek erişimi gerekçesiz kullanılamaz', {
        detail: `X-Support-Reason başlığı zorunlu ve en az ${MIN_REASON_LENGTH} karakter olmalı.`,
      });
    }
    return reason.slice(0, MAX_REASON_LENGTH);
  }
}
