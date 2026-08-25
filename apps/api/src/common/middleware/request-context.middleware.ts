import { timingSafeEqual } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { isUUID } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../errors/app-error';
import { resolveRequestId, runWithRequestContext, type RequestContext } from '../request-context';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function uuidHeader(request: Request, name: string): string | null {
  const raw = request.headers[name];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (!isUUID(raw)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, `${name} geçerli bir UUID değil`);
  }
  return raw;
}

/**
 * İstek context'i: kiracı, kullanıcı, şube ve istek kimliği.
 *
 * ⚠️ GEÇİCİ KÖPRÜ — Faz 1'e kadar.
 * Gerçek kimlik doğrulaması Batch 1.2'de (JWT) gelecek. O zamana kadar:
 *   - `/platform/*` uçları PLATFORM_ADMIN_TOKEN bearer token'ı ile korunur.
 *   - Kiracı context'i yalnız AUTH_DEV_MODE açıkken başlıktan okunur; bu bayrak
 *     üretimde env doğrulaması tarafından REDDEDİLİR.
 * Batch 1.2 geldiğinde yalnızca `resolveContext` gövdesi JWT çözümlemesiyle
 * değişecek; `TenantTxService` sözleşmesi ve tüm çağıran kod aynı kalacak.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  private resolveContext(request: Request, requestId: string): RequestContext {
    const authHeader = request.headers.authorization ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const platformToken = this.config.get('PLATFORM_ADMIN_TOKEN', { infer: true });

    const isPlatformAdmin =
      platformToken !== undefined && bearer.length > 0 && safeEqual(bearer, platformToken);

    if (!this.config.get('AUTH_DEV_MODE', { infer: true })) {
      return {
        tenantId: null,
        userId: null,
        branchId: null,
        requestId,
        isPlatformAdmin,
      };
    }

    return {
      tenantId: uuidHeader(request, 'x-tenant-id'),
      userId: uuidHeader(request, 'x-user-id'),
      branchId: uuidHeader(request, 'x-branch-id'),
      requestId,
      isPlatformAdmin,
    };
  }

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request);
    request.id = requestId;
    // İstek kimliğini yanıta da yaz: kullanıcı bir hatayı bildirdiğinde bu id
    // ile log ve trace tek adımda bulunabilsin.
    response.setHeader('x-request-id', requestId);

    const ctx = this.resolveContext(request, requestId);
    request.ctx = ctx;
    // `next()` ÇAĞRISI store'un İÇİNDE olmalı; zincirin geri kalanı ve tüm
    // async devamları bağlamı buradan devralır.
    runWithRequestContext(ctx, next);
  }
}
