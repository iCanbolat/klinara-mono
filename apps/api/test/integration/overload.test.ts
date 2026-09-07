import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { http } from '../helpers/identity';
import { OverloadService } from '../../src/common/overload/overload.service';

interface Problem {
  code: string;
  status: number;
  detail?: string;
}

const METRICS_TOKEN = 'asiri-yuk-metrik-tokeni';

/** Event loop'u BLOKE eder — aşırı yükün taklidi değil, kendisi. */
function blockEventLoop(durationMs: number): void {
  const until = Date.now() + durationMs;
  while (Date.now() < until) {
    // meşgul bekleme
  }
}

/**
 * Batch 10.3 — aşırı yük koruması.
 *
 * Faz 0'da `@fastify/under-pressure`ın NestJS karşılığı olmadığı için
 * ertelenmiş, Ek B'de açık madde olarak yazılmıştı. Buradaki soru "eşik doğru
 * mu" değil (o işletme kararıdır), "eşik aşıldığında sistem NE YAPIYOR".
 */
describe('aşırı yük koruması (Batch 10.3)', () => {
  let app: NestExpressApplication;
  let overload: OverloadService;

  beforeAll(async () => {
    app = await createTestApp({
      env: {
        OVERLOAD_PROTECTION_ENABLED: 'true',
        OVERLOAD_MAX_EVENT_LOOP_DELAY_MS: '50',
        // Zamanlayıcı testin ortasında araya girmesin: örnekleme elle
        // tetikleniyor, böylece "ne zaman ölçüldü" belirsizliği yok.
        OVERLOAD_SAMPLE_INTERVAL_MS: '600000',
        OVERLOAD_RETRY_AFTER_SECONDS: '7',
        METRICS_TOKEN,
      },
    });
    overload = app.get(OverloadService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('normal koşulda istekler geçer', async () => {
    overload.sample();
    expect(overload.isOverloaded).toBe(false);
    const res = await http(app).get('/api/v1/me');
    expect(res.status).toBe(401); // kimlik yok — ama 503 DEĞİL
  });

  it('event loop tıkandığında 503 + Retry-After döner', async () => {
    blockEventLoop(300);
    // Ölçüm libuv zamanlayıcısının GECİKMESİNİ okur; blok sırasında o
    // zamanlayıcı hiç koşamaz. Bir tur beklemeden örneklemek, gecikmeyi
    // henüz kaydedilmemişken sormak olurdu.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const snapshot = overload.sample();

    expect(snapshot.overloaded).toBe(true);
    expect(snapshot.reason).toBe('event-loop');
    expect(snapshot.eventLoopDelayMs).toBeGreaterThan(50);

    const res = await http(app).get('/api/v1/me');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.body as Problem).code).toBe('SERVICE_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('7');
  });

  it('sağlık ve metrik uçları aşırı yükte de cevap verir', async () => {
    expect(overload.isOverloaded).toBe(true);

    // Yük dengeleyici sürecin canlı olduğunu görebilmeli; Prometheus da tam
    // yangın sırasında scrape edebilmeli. Bu uçlar 503'e kapatılsaydı olayın
    // kendisi görünmez olurdu.
    expect((await http(app).get('/healthz')).status).toBe(200);
    const metrics = await http(app)
      .get('/metrics')
      .set('authorization', `Bearer ${METRICS_TOKEN}`);
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('klinara_overload{signal="active",service="klinara-api"} 1');
    expect(metrics.text).toContain('klinara_overload{signal="event_loop_delay_ms",service="klinara-api"}');
  });

  it('yük geçtiğinde koruma KALKAR — pencere her örneklemede sıfırlanır', async () => {
    const snapshot = overload.sample();
    expect(snapshot.overloaded).toBe(false);

    const res = await http(app).get('/api/v1/me');
    expect(res.status).toBe(401);
  });
});
