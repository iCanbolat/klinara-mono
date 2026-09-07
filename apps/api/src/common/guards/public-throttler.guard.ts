import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerStorage,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { THROTTLER_LIMIT, THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';
import { ERROR_CODES } from '@klinara/shared';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { ThrottlerRequest } from '@nestjs/throttler/dist/throttler.guard.interface';

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
 *
 * 3. **Kendi bütçesi (Batch 10.3).** Uç bazlı `@Throttle` yazılmamış public
 *    uçlar bugüne kadar İÇ API'nin bütçesine (`RATE_LIMIT_MAX`, dakikada 300)
 *    düşüyordu. `PUBLIC_RATE_LIMIT_MAX` / `PUBLIC_RATE_LIMIT_WINDOW_MS`
 *    Faz 9'da tanımlanmış ama HİÇBİR YERDE OKUNMAMIŞTI — public trafiğin ayrı
 *    bir bütçesi olduğu sanılıyordu, oysa yoktu. Uç bazlı sınırlar (OTP:
 *    dakikada 5) olduğu gibi kalır ve bu varsayılanı EZER.
 */
@Injectable()
export class PublicThrottlerGuard extends ThrottlerGuard {
  private readonly publicLimit: number;
  private readonly publicWindowMs: number;

  constructor(
    @Inject(THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    super(options, storageService, reflector);
    this.publicLimit = config.get('PUBLIC_RATE_LIMIT_MAX', { infer: true });
    this.publicWindowMs = config.get('PUBLIC_RATE_LIMIT_WINDOW_MS', { infer: true });
  }

  /**
   * Ucun kendi `@Throttle`ı yoksa public bütçesini uygula.
   *
   * Sınırın nereden geldiğini burada yeniden sormak zorundayız: `handleRequest`
   * kendisine gelen sayıyı, ucun mu yoksa varsayılanın mı verdiğini bilmez.
   */
  protected override handleRequest(request: ThrottlerRequest): Promise<boolean> {
    const routeLimit: unknown = this.reflector.getAllAndOverride(
      THROTTLER_LIMIT + request.throttler.name,
      [request.context.getHandler(), request.context.getClass()],
    );
    if (routeLimit !== undefined) return super.handleRequest(request);

    return super.handleRequest({
      ...request,
      limit: this.publicLimit,
      ttl: this.publicWindowMs,
      blockDuration: this.publicWindowMs,
    });
  }

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
