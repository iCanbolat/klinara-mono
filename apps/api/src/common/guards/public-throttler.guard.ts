import { Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ERROR_CODES } from '@klinara/shared';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';

/**
 * Public randevu uçlarının hız sınırı.
 *
 * İki fark var ve ikisi de gerekli:
 *
 * 1. **Sayaç IP + SLUG bazlı.** Yalnız IP'ye bakmak, bir kliniğin sayfasını
 *    tarayan bir botun aynı IP'den gelen BAŞKA kliniklerin ziyaretçilerini de
 *    engellemesi demekti (ortak NAT arkasındaki bir ofis, bir GSM operatörü).
 *    Yalnız slug'a bakmak ise bir kliniğin sayfasını herkese kapatmak için tek
 *    bir botun yeteceği anlamına gelirdi.
 *
 * 2. **`Retry-After` başlığı.** `AppThrottlerGuard` gövdede süreyi söylüyor
 *    ama başlığı yazmıyor; bir tarayıcı istemcisi ve CDN için standart olan
 *    şey başlık.
 */
@Injectable()
export class PublicThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Request): Promise<string> {
    const slug = (request.params as Record<string, string | undefined>)['slug'] ?? '-';
    // `request.ip` `trust proxy` sayesinde gerçek istemciyi verir
    // (bkz. configure-app.ts).
    return Promise.resolve(`${request.ip ?? 'unknown'}|${slug}`);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(Math.ceil(detail.timeToExpire), 1);
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', String(seconds));
    // Hız sınırı yanıtı CACHE'LENMEZ: bir CDN 429'u tutarsa sınır süresi
    // dolduktan sonra da herkes 429 almaya devam ederdi.
    response.setHeader('Cache-Control', 'no-store');

    return Promise.reject(
      new AppError(429, ERROR_CODES.RATE_LIMITED, 'Çok fazla istek gönderdiniz', {
        detail: `${seconds} saniye içinde tekrar deneyin.`,
      }),
    );
  }
}
