import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../lib/errors.js';
import { withTenantTx, type TenantContext, type Tx } from '../db/tenant-tx.js';
import type { Env } from '../config/env.js';

const uuidSchema = z.uuid();

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
}

function parseUuidHeader(request: FastifyRequest, name: string): string | null {
  const raw = headerValue(request, name);
  if (raw === null) return null;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, `${name} geçerli bir UUID değil`);
  }
  return parsed.data;
}

/**
 * İstek context'i: kiracı, kullanıcı, şube ve istek kimliği.
 *
 * ⚠️ GEÇİCİ KÖPRÜ — Faz 1'e kadar.
 * Gerçek kimlik doğrulaması Batch 1.2'de (JWT) gelecek. O zamana kadar:
 *   - `/platform/*` uçları PLATFORM_ADMIN_TOKEN bearer token'ı ile korunur.
 *   - Kiracı context'i yalnız AUTH_DEV_MODE açıkken başlıktan okunur; bu bayrak
 *     üretimde env doğrulaması tarafından REDDEDİLİR.
 * Batch 1.2 geldiğinde `resolveContext` gövdesi JWT çözümlemesiyle değiştirilecek;
 * `withTenantTx` sözleşmesi ve tüm çağıran kod aynı kalacak.
 */
function resolveContext(request: FastifyRequest, env: Env): TenantContext {
  const authHeader = request.headers.authorization ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const isPlatformAdmin =
    env.PLATFORM_ADMIN_TOKEN !== undefined &&
    bearer.length > 0 &&
    safeEqual(bearer, env.PLATFORM_ADMIN_TOKEN);

  if (!env.AUTH_DEV_MODE) {
    return {
      tenantId: null,
      userId: null,
      branchId: null,
      requestId: request.id,
      isPlatformAdmin,
    };
  }

  return {
    tenantId: parseUuidHeader(request, 'x-tenant-id'),
    userId: parseUuidHeader(request, 'x-user-id'),
    branchId: parseUuidHeader(request, 'x-branch-id'),
    requestId: request.id,
    isPlatformAdmin,
  };
}

async function requestContextPlugin(app: FastifyInstance, opts: { env: Env }) {
  // Değer vermeden bildiriyoruz: gerçek değer her istekte onRequest'te atanır.
  // Bildirim yine de önemli — V8'in tüm request nesnelerini aynı gizli sınıfta
  // tutmasını sağlar.
  app.decorateRequest('ctx');

  app.addHook('onRequest', async (request) => {
    request.ctx = resolveContext(request, opts.env);
  });

  /** Kiracı kapsamlı transaction. Context yoksa açık bir hata verir. */
  app.decorate('tenantTx', function <T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>) {
    if (request.ctx.tenantId === null) {
      throw new AppError(
        401,
        ERROR_CODES.TENANT_CONTEXT_MISSING,
        'Kiracı context\'i belirlenemedi',
        { detail: 'Bu uç bir kiracı bağlamında çalışır; kimlik doğrulaması gerekli.' },
      );
    }
    return withTenantTx(app.db, request.ctx, fn);
  });

  /** Platform yönetimi kapsamlı transaction (kiracı context'i olmadan). */
  app.decorate('platformTx', function <T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>) {
    if (!request.ctx.isPlatformAdmin) {
      throw AppError.forbidden('Bu işlem platform yöneticisi yetkisi gerektirir');
    }
    return withTenantTx(app.db, request.ctx, fn);
  });
}

export default fp(requestContextPlugin, { name: 'request-context', dependencies: ['error-handler'] });
