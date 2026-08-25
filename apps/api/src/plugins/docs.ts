import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { Env } from '../config/env.js';

/**
 * OpenAPI dokümanı — Zod şemalarından OTOMATİK üretilir.
 *
 * Elle yazılan API dokümanı gerçekle er ya da geç ayrışır. Burada tek kaynak
 * rota şemalarıdır: bir uç Zod şeması olmadan tanımlanırsa dokümanda da eksik
 * görünür, bu da eksikliği fark etmenin en kolay yolu olur.
 */
async function docsPlugin(app: FastifyInstance, opts: { env: Env }) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Klinara API',
        description:
          'Medikal estetik, güzellik ve diş/tıp klinikleri için randevu ve klinik yönetim API\'si.',
        version: opts.env.SERVICE_VERSION,
      },
      servers: [{ url: '/', description: 'Geçerli sunucu' }],
      tags: [
        { name: 'system', description: 'Sağlık, hazırlık ve metrikler' },
        { name: 'tenancy', description: 'Kiracı ve şube yönetimi' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // @fastify/swagger spec'i kendiliğinden bir uçta yayınlamaz; makineyle
  // tüketilebilmesi için (istemci üretimi, sözleşme testleri) açıkça sunuyoruz.
  app.get(
    '/openapi.json',
    { schema: { hide: true }, config: { public: true } },
    async () => app.swagger(),
  );

  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: { title: 'Klinara API' },
  });
}

export default fp(docsPlugin, { name: 'docs' });
