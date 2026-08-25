import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { currentMigrationVersion } from '../../db/migrate.js';

const ReadyResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
  migrationVersion: z.string().nullable(),
});

/**
 * Readiness — "bu instance trafik alabilir mi?".
 *
 * `/healthz`ten farkı: bağımlılıkları GERÇEKTEN yoklar. DB düştüğünde bu uç 503
 * döner, load balancer instance'ı havuzdan çıkarır ama süreç yeniden
 * başlatılmaz — bağlantı geri geldiğinde kendiliğinden trafiğe döner.
 */
export async function readinessRoutes(app: FastifyInstance, opts: { pool: pg.Pool }) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/readyz',
    {
      schema: {
        summary: 'Readiness kontrolü (DB + migration sürümü)',
        tags: ['system'],
        response: { 200: ReadyResponse, 503: ReadyResponse },
      },
      config: { public: true },
    },
    async (_request, reply) => {
      try {
        await opts.pool.query('select 1');
        const migrationVersion = await currentMigrationVersion(opts.pool);
        return { status: 'ready' as const, checks: { database: 'up' as const }, migrationVersion };
      } catch (error) {
        app.log.error({ err: error }, 'Readiness kontrolü başarısız: veritabanına ulaşılamıyor');
        return reply.code(503).send({
          status: 'not_ready' as const,
          checks: { database: 'down' as const },
          migrationVersion: null,
        });
      }
    },
  );
}
