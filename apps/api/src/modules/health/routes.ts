import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const HealthResponse = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
});

/**
 * Liveness — "süreç ayakta mı?".
 *
 * Kasıtlı olarak hiçbir bağımlılığı (DB, kuyruk) kontrol ETMEZ. Bu ucun görevi
 * orkestratöre süreci yeniden başlatması gerekip gerekmediğini söylemektir;
 * DB'nin düşmesi süreci yeniden başlatmakla düzelmez. Bağımlılık kontrolü
 * `/readyz` işidir (Batch 0.2).
 */
export async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/healthz',
    {
      schema: {
        summary: 'Liveness kontrolü',
        tags: ['system'],
        response: { 200: HealthResponse },
      },
      config: { public: true },
    },
    async () => ({
      status: 'ok' as const,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
}
