import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import type { Request, Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AppError } from '../errors/app-error';
import { OverloadService } from './overload.service';

/**
 * Aşırı yük altında yeni isteği 503 + `Retry-After` ile geri çevirir.
 *
 * KABUL ETMEMEK, KABUL EDİP YETİŞTİREMEMEKTEN İYİDİR: dolmuş bir süreçte her
 * yeni istek in-flight olanların da süresini uzatır ve sonunda hepsi birden
 * zaman aşımına uğrar. Erken 503, yük dengeleyiciye "beni atla" demenin ve
 * istemciye tekrar denemesi için süre vermenin standart yoludur.
 *
 * En ÖNDEKİ guard'dır — hız sınırından da önce: aşırı yük altında sayaç için
 * veritabanına gitmenin bile maliyeti var.
 */
@Injectable()
export class OverloadGuard implements CanActivate {
  private readonly retryAfterSeconds: number;

  constructor(
    private readonly overload: OverloadService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.retryAfterSeconds = config.get('OVERLOAD_RETRY_AFTER_SECONDS', { infer: true });
  }

  /**
   * Altyapı uçları koruma DIŞINDADIR.
   *
   * Yük dengeleyici sürecin canlı olduğunu görebilmeli ve Prometheus tam da
   * yangın sırasında scrape edebilmelidir; bu uçları 503'e kapatmak, olayın
   * kendisini görünmez yapardı. `/readyz` de dışarıda: hazır olmamak başka
   * şeydir (bağımlılık düştü), doluluk başka.
   */
  private static readonly EXEMPT = new Set(['/healthz', '/readyz', '/metrics']);

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (!this.overload.isOverloaded) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (OverloadGuard.EXEMPT.has(request.path)) return true;

    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(this.retryAfterSeconds));

    throw new AppError(
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
      'Sunucu şu anda çok yoğun',
      {
        detail: `${this.retryAfterSeconds} saniye içinde tekrar deneyin.`,
      },
    );
  }
}
