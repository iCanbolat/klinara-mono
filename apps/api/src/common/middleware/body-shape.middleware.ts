import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import type { NextFunction, Request, Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AppError } from '../errors/app-error';

/**
 * Gövdenin BİÇİMSEL sınırları: iç içe geçme derinliği ve dizi uzunluğu.
 *
 * `BODY_LIMIT_BYTES` yalnız BOYUTU sınırlar ve bu yetmez: 100 KB'lik bir gövde
 * `[[[[[…]]]]]` biçiminde on binlerce seviye derinlikte olabilir. Böyle bir
 * gövde parse edildikten sonra onu GEZEN her şey — `class-validator`,
 * `class-transformer`, `JSON.stringify`, log serializer'ı — özyinelemeli
 * çalışır ve ya süreci saniyelerce meşgul eder ya da yığını taşırır. Ölçü
 * "kaç bayt" değil, "kaç düğüm ve ne kadar derin" olmalıdır.
 *
 * Kontrol doğrulamadan (`ValidationPipe`) ÖNCE koşar: sırası tersine olsaydı
 * korumak istediğimiz özyineleme zaten çalışmış olurdu.
 */
@Injectable()
export class BodyShapeMiddleware implements NestMiddleware {
  private readonly maxDepth: number;
  private readonly maxArrayLength: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.maxDepth = config.get('BODY_MAX_DEPTH', { infer: true });
    this.maxArrayLength = config.get('BODY_MAX_ARRAY_LENGTH', { infer: true });
  }

  use(request: Request, _response: Response, next: NextFunction): void {
    const body: unknown = request.body;
    if (body !== null && typeof body === 'object') this.assertShape(body);
    next();
  }

  /**
   * Derinliği YİNELEMELİ (özyinelemesiz) ölçer.
   *
   * Özyinelemeli bir kontrol, tam da engellemeye çalıştığı gövdede yığını
   * taşırırdı — kontrolün kendisi açık hâline gelirdi.
   */
  private assertShape(root: object): void {
    const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 1 }];

    while (stack.length > 0) {
      const { value, depth } = stack.pop() as { value: unknown; depth: number };
      if (value === null || typeof value !== 'object') continue;

      if (depth > this.maxDepth) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'İstek gövdesi çok derin', {
          detail: `İç içe geçme sınırı: ${this.maxDepth}.`,
        });
      }

      if (Array.isArray(value)) {
        if (value.length > this.maxArrayLength) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'İstek gövdesindeki dizi çok uzun', {
            detail: `Dizi uzunluğu sınırı: ${this.maxArrayLength}.`,
          });
        }
        for (const item of value) stack.push({ value: item, depth: depth + 1 });
        continue;
      }

      for (const item of Object.values(value)) stack.push({ value: item, depth: depth + 1 });
    }
  }
}
