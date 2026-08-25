import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { AppError } from '../lib/errors.js';
import type { Env } from '../config/env.js';

export interface BusinessMetrics {
  appointmentsCreated: Counter<'branch_id' | 'source'>;
  slotConflicts: Counter<'resource_type'>;
  notificationsSent: Counter<'channel' | 'status'>;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Prometheus metrikleri.
 *
 * RED (Rate, Errors, Duration) metriklerine ek olarak iş metrikleri de burada
 * tanımlanır — "sistem ayakta ama randevu oluşmuyor" durumunu yalnız teknik
 * metriklerle göremezsiniz.
 */
async function metricsPlugin(app: FastifyInstance, opts: { env: Env }) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: opts.env.SERVICE_NAME });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP istek süresi',
    labelNames: ['method', 'route', 'status_code'] as const,
    // Hedeflerimiz: randevu oluşturma p95 < 120ms, takvim < 150ms, uygunluk < 200ms.
    buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const businessMetrics: BusinessMetrics = {
    appointmentsCreated: new Counter({
      name: 'klinara_appointments_created_total',
      help: 'Oluşturulan randevu sayısı',
      labelNames: ['branch_id', 'source'] as const,
      registers: [registry],
    }),
    slotConflicts: new Counter({
      name: 'klinara_slot_conflicts_total',
      help: 'Veritabanı seviyesinde reddedilen çakışma sayısı',
      labelNames: ['resource_type'] as const,
      registers: [registry],
    }),
    notificationsSent: new Counter({
      name: 'klinara_notifications_total',
      help: 'Gönderilen bildirim sayısı',
      labelNames: ['channel', 'status'] as const,
      registers: [registry],
    }),
  };

  app.decorate('metrics', businessMetrics);

  app.addHook('onResponse', async (request, reply) => {
    // Ham URL değil ROTA şablonu kullanılır (/customers/:id), aksi hâlde her
    // uuid ayrı bir zaman serisi yaratır ve Prometheus'u patlatır.
    const route = request.routeOptions.url ?? 'unknown';
    if (route === '/metrics') return;
    httpDuration.observe(
      { method: request.method, route, status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });

  app.route({
    method: 'GET',
    url: '/metrics',
    schema: { hide: true },
    config: { public: true },
    handler: async (request, reply) => {
      const expected = opts.env.METRICS_TOKEN;
      if (expected !== undefined) {
        const header = request.headers.authorization ?? '';
        const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (!safeEqual(provided, expected)) {
          throw AppError.unauthenticated('Metrik ucu için geçerli token gerekli');
        }
      }
      const body = await registry.metrics();
      return reply.type(registry.contentType).send(body);
    },
  });
}

export default fp(metricsPlugin, { name: 'metrics' });
