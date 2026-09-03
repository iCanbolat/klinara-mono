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

  /**
   * ⚠️ `init()` DEĞİL `listen()`: uygulama testin ömrü boyunca TEK BİR kez
   * dinlemeye alınıyor.
   *
   * Sebebi supertest'in davranışı. `request(server)` çağrıldığında sunucu
   * dinlemiyorsa supertest onu KENDİSİ `listen(0)` ile açıyor ve istek bitince
   * `close()` ediyor (`supertest/lib/test.js`). `init()` ile bırakılan bir
   * uygulamada bu, her istek başına bir aç-kapa demek — tam koşumda binlerce
   * kez. İki sonucu var:
   *
   * 1. Eş zamanlı iki istek AYNI sunucuyu paylaşıyor; ilk biten `close()`
   *    çağırıp soketi ötekinin altından çekiyor.
   * 2. Kapanan efemeral portu, bir sonraki `listen(0)`a kadar makinedeki
   *    BAŞKA bir süreç kapabiliyor. O aralıkta gönderilen istek başka bir
   *    sunucuya düşüyor ve dönen yanıt bizim RFC 9457 biçimimizde OLMUYOR —
   *    Ek P'de kayıtlı "tam koşumda rastgele bir dosya 401 alıyor, gövde
   *    Anthropic API'sinin hata şekli" belirtisi tam olarak budur.
   *
   * Sunucu baştan dinlediği için supertest hiç `listen`/`close` yapmıyor;
   * soket `app.close()`a kadar ayakta kalıyor. Port `0` (efemeral) ve adres
   * `127.0.0.1`: testler dışarıdan erişilebilir bir port açmamalı.
   */
  await app.listen(0, '127.0.0.1');
  return app;
}
