import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import { ERROR_CODES } from '@klinara/shared';
import { corsOrigins, type Env } from '../config/env.js';

/**
 * Taşıma katmanı korumaları: güvenlik başlıkları, CORS, hız sınırı, aşırı yük koruması.
 *
 * NOT: Hız sınırı şimdilik süreç-içi (in-memory) sayaç kullanır — tek instance
 * varsayımı. Yatay ölçeğe geçildiğinde PostgreSQL tabanlı dağıtık token bucket'a
 * taşınacak (Batch 10.3).
 */
async function securityPlugin(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;

  await app.register(helmet, {
    contentSecurityPolicy: false, // API JSON döndürür; CSP'yi /docs sayfası kendi ayarlar
  });

  const origins = corsOrigins(env);
  await app.register(cors, {
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Sağlık ve metrik uçları izleme sistemleri tarafından sık çağrılır; sınırlama dışı.
    allowList: (req) => req.url === '/healthz' || req.url === '/readyz' || req.url === '/metrics',
    errorResponseBuilder: (req, context) => ({
      type: 'https://errors.klinara.app/rate-limited',
      title: 'Çok fazla istek gönderdiniz',
      status: 429,
      code: ERROR_CODES.RATE_LIMITED,
      detail: `${context.after} içinde tekrar deneyin.`,
      instance: req.url,
      requestId: req.id,
    }),
  });

  await app.register(underPressure, {
    maxEventLoopDelay: 1_000,
    maxHeapUsedBytes: 1_073_741_824,
    maxEventLoopUtilization: 0.98,
    message: 'Sunucu şu anda aşırı yük altında',
    retryAfter: 5,
    exposeStatusRoute: false,
  });
}

export default fp(securityPlugin, { name: 'security' });
