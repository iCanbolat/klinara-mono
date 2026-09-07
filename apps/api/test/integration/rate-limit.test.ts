import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { ConfigService } from '@nestjs/config';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { http } from '../helpers/identity';
import { PgThrottlerStorage } from '../../src/common/rate-limit/pg-throttler.storage';

interface Problem {
  code: string;
  status: number;
  detail?: string;
}

/** İç API için küçük bir bütçe; testin birkaç istekte sınıra dayanması için. */
const INTERNAL_LIMIT = 5;
/** Public sayfanın AYRI bütçesi — iç API'den bağımsız olduğu görülsün diye daha küçük. */
const PUBLIC_LIMIT = 3;

const RATE_LIMIT_ENV = {
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_STORAGE: 'postgres',
  RATE_LIMIT_MAX: String(INTERNAL_LIMIT),
  RATE_LIMIT_WINDOW_MS: '60000',
  PUBLIC_RATE_LIMIT_MAX: String(PUBLIC_LIMIT),
  PUBLIC_RATE_LIMIT_WINDOW_MS: '60000',
};

/**
 * Batch 10.3 — dağıtık hız sınırı.
 *
 * Bugüne kadar hız sınırının KENDİSİ hiç sınanmamıştı: tüm test ortamı
 * `RATE_LIMIT_ENABLED=false` ile koşuyor (uç bazlı sıkı sınırlar testleri
 * birbirine bağlardı) ve 429 bekleyen mevcut testlerin hepsi UYGULAMA
 * seviyesindeki sayaçlara ait (hesap kilidi, tutma limiti). Yani hız
 * sınırlayıcının çalıştığına dair elde hiçbir kanıt yoktu.
 *
 * Buradaki asıl iddia ikinci testte: sayaç veritabanında olduğu için AYRI İKİ
 * UYGULAMA aynı bütçeyi paylaşır. Süreç-içi `Map` ile bu test kırmızı olurdu
 * (her instance kendi sayacını tutar, sınır ikiye katlanır) — 10.3'ün
 * kapatmaya çalıştığı açık tam olarak budur.
 */
describe('dağıtık hız sınırı (Batch 10.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  /** İkinci "instance" — aynı veritabanı, ayrı süreç-içi durum. */
  let secondInstance: NestExpressApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    const env = { ...RATE_LIMIT_ENV, DATABASE_URL: database.appUrl };
    app = await createTestApp({ env });
    secondInstance = await createTestApp({ env });
  });

  afterAll(async () => {
    await app.close();
    await secondInstance.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
  });

  it('sınır aşıldığında RFC 9457 gövdesiyle 429 ve Retry-After döner', async () => {
    for (let attempt = 0; attempt < INTERNAL_LIMIT; attempt += 1) {
      const res = await http(app).get('/api/v1/me');
      // Kimlik yok: 401 bekleniyor. Önemli olan HENÜZ 429 OLMAMASI.
      expect(res.status).toBe(401);
    }

    const limited = await http(app).get('/api/v1/me');
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect((limited.body as Problem).code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('İKİ AYRI instance aynı bütçeyi paylaşır — sayaç süreçte değil veritabanında', async () => {
    // Bütçenin tamamını BİRİNCİ instance harcar.
    for (let attempt = 0; attempt < INTERNAL_LIMIT; attempt += 1) {
      await http(app).get('/api/v1/me');
    }

    // İkinci instance'ın kendi süreç-içi sayacı BOŞ. Süreç-içi depolamada bu
    // istek 401 dönerdi; paylaşılan sayaçta 429 döner.
    const acrossInstances = await http(secondInstance).get('/api/v1/me');
    expect(acrossInstances.status).toBe(429);
  });

  it('sayaç satırı gerçekten PostgreSQL’de tutuluyor', async () => {
    await http(app).get('/api/v1/me');
    const { rows } = await database.ownerPool.query<{ bucket_key: string; hits: number }>(
      'select bucket_key, hits from rate_limit_counters',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.bucket_key.startsWith('default:'))).toBe(true);
  });

  it('public sayfanın kendi bütçesi vardır ve klinik (slug) bazlıdır', async () => {
    // `PUBLIC_RATE_LIMIT_MAX` Faz 9'dan beri tanımlıydı ama okunmuyordu;
    // uç bazlı `@Throttle` taşımayan public uçlar iç API'nin 300'lük
    // bütçesine düşüyordu. Artık kendi bütçesini kullanıyor.
    const seen: number[] = [];
    for (let attempt = 0; attempt < PUBLIC_LIMIT; attempt += 1) {
      const res = await http(app).get('/api/v1/public/sites/klinik-a/');
      seen.push(res.status);
    }
    expect(seen).toEqual([404, 404, 404]); // site yok; sayaç yine de işliyor

    const blocked = await http(app).get('/api/v1/public/sites/klinik-a/');
    expect(blocked.status).toBe(429);
    expect((blocked.body as Problem).code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    // 429 CDN tarafından TUTULMAMALI: tutulursa sınır dolduktan sonra da
    // herkes 429 almaya devam ederdi.
    expect(blocked.headers['cache-control']).toContain('no-store');

    // BAŞKA bir klinik etkilenmez: bütçe IP + slug çiftine bağlıdır.
    const otherClinic = await http(app).get('/api/v1/public/sites/klinik-b/');
    expect(otherClinic.status).toBe(404);
  });

  it('public bütçe tükendiğinde iç API kapanmaz', async () => {
    for (let attempt = 0; attempt < PUBLIC_LIMIT + 2; attempt += 1) {
      await http(app).get('/api/v1/public/sites/klinik-c/');
    }
    const internal = await http(app).get('/api/v1/me');
    expect(internal.status).toBe(401);
  });

  it('eş zamanlı vuruşlar KAYBOLMAZ — sayaç satır kilidiyle atomiktir', async () => {
    // 10.3'ün düzeltmeye çalıştığı hata tam olarak bu sınıftan: "oku, artır,
    // yaz" üç ayrı adım olsaydı eş zamanlı 20 istek 20'den az sayılır ve sınır
    // sessizce gevşerdi. Ayrı bağlantılardan koşuyoruz; tek bağlantıda sorgular
    // zaten sıraya girer ve test hiçbir şey ispatlamazdı.
    const CONCURRENCY = 20;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        database.appPool.query('select * from rate_limit_hit($1, $2, $3, $4)', [
          'yaris-testi',
          60_000,
          CONCURRENCY * 2,
          60_000,
        ]),
      ),
    );

    const { rows } = await database.ownerPool.query<{ hits: number }>(
      'select hits from rate_limit_counters where bucket_key = $1',
      ['yaris-testi'],
    );
    expect(rows[0]?.hits).toBe(CONCURRENCY);
  });

  it('veritabanı yazamadığında istek REDDEDİLMEZ, süreç-içi sayaca düşülür', async () => {
    const brokenPool = {
      query: () => Promise.reject(new Error('bağlantı yok')),
    } as unknown as pg.Pool;
    const logger = await app.resolve(PinoLogger);
    const storage = new PgThrottlerStorage(
      brokenPool,
      logger,
      app.get<ConfigService>(ConfigService) as never,
    );

    const first = await storage.increment('test-anahtari', 60_000, 2, 60_000, 'default');
    expect(first.totalHits).toBe(1);
    expect(first.isBlocked).toBe(false);

    // Yedek sayaç ÇALIŞIYOR olmalı: düşüş "sınır yok" demek değildir.
    await storage.increment('test-anahtari', 60_000, 2, 60_000, 'default');
    const third = await storage.increment('test-anahtari', 60_000, 2, 60_000, 'default');
    expect(third.isBlocked).toBe(true);

    storage.onApplicationShutdown();
  });
});
