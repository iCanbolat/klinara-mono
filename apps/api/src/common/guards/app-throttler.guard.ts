import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../errors/app-error';

/**
 * Hız sınırı aşımını da RFC 9457 gövdesiyle döndürür — istemci tüm hataları
 * tek bir biçimde ayrıştırabilsin diye.
 *
 * NOT: Sayaç süreç-içidir (tek instance varsayımı). Yatay ölçeğe geçildiğinde
 * PostgreSQL tabanlı dağıtık token bucket'a taşınacak (Batch 10.3).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(Math.ceil(detail.timeToExpire), 1);
    return Promise.reject(
      new AppError(429, ERROR_CODES.RATE_LIMITED, 'Çok fazla istek gönderdiniz', {
        detail: `${seconds} saniye içinde tekrar deneyin.`,
      }),
    );
  }
}
