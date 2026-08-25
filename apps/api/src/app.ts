import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import securityPlugin from './plugins/security.js';
import { healthRoutes } from './modules/health/routes.js';
import { readinessRoutes } from './modules/health/readiness.js';
import { createDb, type DbHandle } from './db/client.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import metricsPlugin from './plugins/metrics.js';
import docsPlugin from './plugins/docs.js';
import requestContextPlugin from './plugins/request-context.js';
import { tenancyRoutes } from './modules/tenancy/routes.js';
import { REDACT_PATHS, censor } from './lib/redaction.js';
import type { Env } from './config/env.js';

/**
 * `exactOptionalPropertyTypes` açıkken Fastify'ın opsiyonel `logger` alanına
 * `undefined` geçilemez; bu yüzden `undefined`'ı tipten çıkarıyoruz.
 */
type LoggerOption = NonNullable<FastifyServerOptions['logger']>;
/** Logger'ın nesne biçimi (`true`/`false` kısayolları hariç) — üzerine ekleme yapabilmek için. */
type LoggerObjectOption = Exclude<LoggerOption, boolean>;

export interface BuildAppOptions {
  env: Env;
  /** Testlerde logger'ı bastırmak (`false`) veya özelleştirmek için. */
  loggerOverride?: LoggerOption;
  /**
   * Hazır bir veritabanı handle'ı. Testler Testcontainers'tan gelen bağlantıyı
   * buradan enjekte eder; verilmezse env'den kendi havuzunu kurar.
   */
  db?: DbHandle;
  /**
   * Log çıktısını yönlendirmek için (testlerde gerçek redaction davranışını
   * doğrulamak amacıyla). Verilirse logger yapılandırması AYNEN korunur,
   * yalnızca hedef değişir — böylece test gerçek gizleme kurallarını ölçer.
   */
  logStream?: NodeJS.WritableStream;
}

function buildLoggerOptions(env: Env): LoggerObjectOption {
  return {
    level: env.LOG_LEVEL,
    // Sırlar loga hiç girmez; telefon gibi kişisel veriler maskelenir.
    redact: { paths: REDACT_PATHS, censor },
    // Log satırını aktif trace ile ilişkilendir: bir isteğin logu ve trace'i
    // aynı id üzerinden bulunabilsin.
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

/**
 * Fastify örneğini kurar ama DİNLEMEYE BAŞLAMAZ.
 *
 * Bu ayrım kasıtlıdır: testler `app.inject()` ile gerçek bir port açmadan
 * uçları çağırabilir, böylece testler paralel koşabilir ve port çakışması olmaz.
 * Dinleme işi `server.ts`nin sorumluluğudur.
 */
export async function buildApp({
  env,
  loggerOverride,
  db: injectedDb,
  logStream,
}: BuildAppOptions): Promise<FastifyInstance> {
  const baseLogger =
    logStream !== undefined
      ? { ...buildLoggerOptions(env), stream: logStream }
      : (loggerOverride ?? buildLoggerOptions(env));

  const app = Fastify({
    logger: baseLogger,
    // İstemci kendi correlation id'sini verdiyse ONU koru — böylece bir isteğin
    // izi istemciden başlayıp log, trace ve denetim kaydı boyunca aynı kalır.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 200) {
        return incoming;
      }
      return randomUUID();
    },
    bodyLimit: env.BODY_LIMIT_BYTES,
    // Ters proxy arkasında gerçek istemci IP'si (hız sınırı ve denetim kaydı için).
    trustProxy: true,
  });

  // Request id'yi yanıta da yaz: istemci bir hatayı bize bildirdiğinde bu id ile
  // logları ve trace'i tek adımda bulabilelim.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Zod şemalarının hem doğrulama hem serileştirme için kullanılması.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Havuzu biz kurduysak kapatma sorumluluğu da bizde; enjekte edilmişse
  // sahibi testtir ve ona dokunmayız.
  const db =
    injectedDb ??
    createDb(env, {
      onPoolError: (error) => {
        app.log.error({ err: error }, 'Veritabanı havuzunda boştaki bağlantı hatası');
      },
    });
  const ownsDb = injectedDb === undefined;

  app.decorate('db', db.db);
  app.decorate('pool', db.pool);

  app.addHook('onClose', async () => {
    if (ownsDb) await db.close();
  });

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, { env });
  await app.register(metricsPlugin, { env });
  await app.register(docsPlugin, { env });
  await app.register(requestContextPlugin, { env });

  await app.register(healthRoutes);
  await app.register(readinessRoutes, { pool: db.pool });
  await app.register(tenancyRoutes);

  return app;
}
