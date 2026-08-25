import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { corsOrigins, type EnvironmentVariables } from './config/env.validation';
import { setupSwagger } from './observability/swagger';

/** API'nin sürümlü kök yolu. Sağlık ve metrik uçları bunun DIŞINDADIR. */
export const API_PREFIX = 'api/v1';
const PREFIX_EXCLUDED = ['healthz', 'readyz', 'metrics'];

/**
 * HTTP katmanı kurulumu — `main.ts` ve testler AYNI fonksiyonu çağırır.
 *
 * Ortak olması kasıtlıdır: testlerin gerçekten üretimdeki uygulamayı ölçmesi
 * için güvenlik başlıkları, gövde limiti, yol öneki ve dokümanın test ortamında
 * da birebir aynı kurulması gerekir.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // pino uygulamanın tek logger'ı; Nest'in kendi çıktısı da oraya akar.
  app.useLogger(app.get(Logger));

  // Ters proxy arkasında gerçek istemci IP'si (hız sınırı ve denetim kaydı için).
  app.set('trust proxy', true);

  app.use(
    helmet({
      // API JSON döndürür; CSP'yi /docs sayfası kendi ayarlar.
      contentSecurityPolicy: false,
    }),
  );

  const origins = corsOrigins({ CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }) });
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    maxAge: 86_400,
  });

  app.useBodyParser('json', { limit: config.get('BODY_LIMIT_BYTES', { infer: true }) });

  app.setGlobalPrefix(API_PREFIX, { exclude: PREFIX_EXCLUDED });

  setupSwagger(app, config.get('SERVICE_VERSION', { infer: true }));
}
