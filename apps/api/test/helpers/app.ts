import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { DestinationStream } from 'pino';
import type { Type } from '@nestjs/common';
import { setLogStream } from '../../src/observability/log-stream';
import { applyTestEnv } from './env';

export interface TestAppOptions {
  /** `process.env` üzerine yazılacak değerler (uygulama kurulmadan önce). */
  env?: Record<string, string>;
  /** Yalnızca teste özgü ek controller'lar. */
  controllers?: Type<unknown>[];
  /** Log çıktısını yakalamak için — gerçek redaction davranışı ölçülebilsin. */
  logStream?: DestinationStream;
}

/**
 * Testler için gerçek uygulamayı kurar.
 *
 * `configureApp` üretimdeki `main.ts` ile AYNI fonksiyondur: güvenlik
 * başlıkları, gövde limiti, `/api/v1` öneki ve OpenAPI dokümanı testte de
 * birebir aynı kurulur.
 *
 * ⚠️ `AppModule` DİNAMİK import edilir. Sebebi `ConfigModule.forRoot()`un
 * `validate`i modül DOSYASI yüklenirken çalıştırmasıdır; `process.env` o andan
 * önce kurulmuş olmalıdır. Bunun doğal sonucu: bir test DOSYASI içindeki tüm
 * uygulamalar aynı ortamı paylaşır (modül önbelleği). Farklı env isteyen
 * senaryolar ayrı dosyalara konur.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  applyTestEnv(options.env ?? {});
  setLogStream(options.logStream);

  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/configure-app');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  }).compile();

  // `rawBody` üretimdeki `main.ts` ile AYNI şekilde açılır: kapalı kalsaydı
  // webhook imza testi yeşil görünürken üretimde imza doğrulanamazdı.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  return app;
}
