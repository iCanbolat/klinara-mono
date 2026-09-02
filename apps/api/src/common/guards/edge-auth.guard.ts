import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { safeEqual } from '../crypto/tokens';
import { AppError } from '../errors/app-error';
import type { EnvironmentVariables } from '../../config/env.validation';

export const EDGE_TOKEN_HEADER = 'x-klinara-edge-token';

/**
 * Kenar proxy'sinin (Caddy on-demand TLS) iç uçlarını koruyan guard.
 *
 * `PLATFORM_ADMIN_TOKEN` bilerek YENİDEN KULLANILMIYOR: o token her kiracının
 * verisini okuyup yazabiliyor. Kenar proxy'sinin tek bir evet/hayır sorusunu
 * ("bu konak adı bize ait mi?") cevaplayabilen kendi kimlik bilgisi var.
 *
 * Bu tek başına yeterli DEĞİLDİR ve öyle olduğu varsayılmamalı: `/api/v1/internal/*`
 * ingress tarafında da internete kapatılır (bkz. 10.4 runbook). Token, ağ
 * yanlış yapılandırıldığında son savunma hattıdır.
 *
 * Uç `@Public()` ile İŞARETLENMEZ: iç bir rotanın "public" görünmesi, ileride
 * o dosyayı okuyan birinin yanlış sonuç çıkarmasına yol açacak tek şeydir.
 */
@Injectable()
export class EdgeAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('EDGE_AUTH_TOKEN', { infer: true });
    if (expected === undefined || expected === '') {
      throw AppError.forbidden('Kenar proxy erişimi yapılandırılmamış');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[EDGE_TOKEN_HEADER];
    if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
      throw AppError.unauthenticated('Kenar proxy token’ı geçersiz');
    }
    return true;
  }
}
