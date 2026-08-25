import { timingSafeEqual } from 'node:crypto';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EnvironmentVariables } from '../config/env.validation';
import { AppError } from '../common/errors/app-error';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * `/metrics` ucunun koruması. Token tanımlı değilse uç açıktır (yerel
 * geliştirme); üretimde `METRICS_TOKEN` env doğrulaması tarafından ZORUNLU
 * kılınır, dolayısıyla üretimde uç her zaman korumalıdır.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('METRICS_TOKEN', { infer: true });
    if (expected === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeEqual(provided, expected)) {
      throw AppError.unauthenticated('Metrik ucu için geçerli token gerekli');
    }
    return true;
  }
}
