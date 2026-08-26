import { timingSafeEqual } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@klinara/shared';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TokenService } from '../../modules/identity/token.service';
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
 * İstek context'i: kiracı, kullanıcı, oturum, şube ve istek kimliği.
 *
 * Kimlik artık access JWT'sinden çözülür (Batch 1.2). Kiracı, token'ın
 * içindedir — istemci başlıkla değiştiremez; `X-Tenant-Id` diye bir başlık
 * ARTIK YOKTUR. Şube ise başlıkla gelir ama üyeliği `AuthGuard` doğrular.
 *
 * Token geçersizse istek burada DÜŞÜRÜLMEZ: hata isteğe iliştirilir ve
 * `AuthGuard` fırlatır. Sebebi public uçlar — geçersiz bir Authorization
 * başlığı, giriş ucunu kullanılamaz hâle getirmemeli.
 *
 * Platform yönetimi (`/platform/*`) ayrı kanaldadır: kiracı-üstü bir işlem
 * olduğu için kiracı JWT'siyle ifade edilemez.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly tokens: TokenService,
  ) {}

  private static bearerOf(request: Request): string {
    const header = request.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  }

  private isPlatformToken(bearer: string): boolean {
    const platformToken = this.config.get('PLATFORM_ADMIN_TOKEN', { infer: true });
    return platformToken !== undefined && bearer.length > 0 && safeEqual(bearer, platformToken);
  }

  private async resolveContext(request: Request, requestId: string): Promise<RequestContext> {
    const base: RequestContext = {
      tenantId: null,
      userId: null,
      branchId: null,
      sessionId: null,
      requestId,
      isPlatformAdmin: false,
    };

    const bearer = RequestContextMiddleware.bearerOf(request);
    if (bearer === '') return base;
    if (this.isPlatformToken(bearer)) return { ...base, isPlatformAdmin: true };

    try {
      const claims = await this.tokens.verifyAccess(bearer);
      request.tokenVersion = claims.tv;
      return {
        ...base,
        tenantId: claims.tid,
        userId: claims.sub,
        sessionId: claims.sid,
        branchId: uuidHeader(request, 'x-branch-id'),
      };
    } catch (error) {
      if (error instanceof AppError) {
        request.authError = error;
        return base;
      }
      throw error;
    }
  }

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request);
    request.id = requestId;
    // İstek kimliğini yanıta da yaz: kullanıcı bir hatayı bildirdiğinde bu id
    // ile log ve trace tek adımda bulunabilsin.
    response.setHeader('x-request-id', requestId);

    void this.resolveContext(request, requestId)
      .then((ctx) => {
        request.ctx = ctx;
        // `next()` ÇAĞRISI store'un İÇİNDE olmalı; zincirin geri kalanı ve tüm
        // async devamları bağlamı buradan devralır.
        runWithRequestContext(ctx, next);
      })
      .catch((error: unknown) => {
        next(error);
      });
  }
}
