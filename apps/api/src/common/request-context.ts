import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from './errors/app-error';

export interface RequestContext {
  tenantId: string | null;
  userId: string | null;
  branchId: string | null;
  /** Access token'daki oturum kimliği; oturum listesi ve iptal için. */
  sessionId: string | null;
  requestId: string;
  isPlatformAdmin: boolean;
}

/** İstek bağlamı olmayan akışlar (CLI, job) için boş bağlam. */
export function emptyContext(requestId = randomUUID()): RequestContext {
  return {
    tenantId: null,
    userId: null,
    branchId: null,
    sessionId: null,
    requestId,
    isPlatformAdmin: false,
  };
}

/**
 * İstek bağlamının taşıyıcısı.
 *
 * `AsyncLocalStorage` sayesinde context'i her fonksiyon imzasında elden ele
 * taşımak gerekmez; servis katmanı `RequestContextService.get()` ile aynı
 * isteğin kiracısına ulaşır. Depolama modül seviyesinde tekildir çünkü
 * middleware DI'dan ÖNCE (Express katmanında) koşar.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/** Aşırı uzun veya boş `x-request-id` başlıkları kabul edilmez. */
const MAX_REQUEST_ID_LENGTH = 200;

/**
 * İstek kimliğini çözer: istemci geçerli bir tane gönderdiyse ONU korur.
 *
 * Böylece bir isteğin izi istemciden başlayıp log, trace ve denetim kaydı
 * boyunca aynı kalır. Hem pino'nun `genReqId`i hem de context middleware'i bu
 * fonksiyonu kullanır — hangisi önce koşarsa koşsun sonuç aynıdır.
 */
export function resolveRequestId(req: { id?: unknown; headers: Record<string, unknown> }): string {
  if (typeof req.id === 'string' && req.id.length > 0) return req.id;
  const incoming = req.headers['x-request-id'];
  if (
    typeof incoming === 'string' &&
    incoming.length > 0 &&
    incoming.length <= MAX_REQUEST_ID_LENGTH
  ) {
    return incoming;
  }
  return randomUUID();
}

/** pino-http `req.id`i `string | number | object` olarak tipler; bize string lazım. */
export function requestIdOf(req: { id?: unknown }): string {
  if (typeof req.id === 'string') return req.id;
  if (typeof req.id === 'number') return String(req.id);
  return '';
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

@Injectable()
export class RequestContextService {
  /** Geçerli isteğin bağlamı; istek dışı bir akıştan çağrıldıysa `undefined`. */
  get(): RequestContext | undefined {
    return storage.getStore();
  }

  /** Kiracı bağlamı zorunlu olan yerler için. */
  requireTenantId(): string {
    const ctx = this.get();
    if (ctx?.tenantId == null) {
      throw new AppError(
        401,
        ERROR_CODES.TENANT_CONTEXT_MISSING,
        "Kiracı context'i belirlenemedi",
        { detail: 'Bu uç bir kiracı bağlamında çalışır; kimlik doğrulaması gerekli.' },
      );
    }
    return ctx.tenantId;
  }

  /** Kimliği doğrulanmış kullanıcının kimliği. */
  requireUserId(): string {
    const ctx = this.get();
    if (ctx?.userId == null) {
      throw AppError.unauthenticated();
    }
    return ctx.userId;
  }

  requirePlatformAdmin(): RequestContext {
    const ctx = this.get();
    if (ctx === undefined || !ctx.isPlatformAdmin) {
      throw AppError.forbidden('Bu işlem platform yöneticisi yetkisi gerektirir');
    }
    return ctx;
  }
}

/** Express isteğinden bağlamı okur (guard ve filtreler için). */
export function contextOf(request: Request): RequestContext | undefined {
  return request.ctx ?? storage.getStore();
}
