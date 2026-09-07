import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { http, PLATFORM_TOKEN, supportReason } from '../helpers/identity';

interface Problem {
  code: string;
  status: number;
  title: string;
  detail?: string;
}

const newTenant = (slug: string) => ({
  slug,
  name: slug,
  branch: { slug: 'merkez', name: 'Merkez' },
  owner: { email: `sahip@${slug}.test`, fullName: 'Sahip' },
});

/**
 * Süre dolumu AYRI BİR DOSYADA: `ConfigModule` ortamı `AppModule` yüklenirken
 * okur ve bir test dosyasındaki tüm uygulamalar aynı ortamı paylaşır
 * (bkz. `createTestApp`). "Süresi dolmuş token" senaryosu bu yüzden kendi
 * dosyasında yaşamak zorunda.
 */
describe('süresi dolmuş destek erişimi (Batch 10.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PLATFORM_ADMIN_TOKEN_NOT_AFTER: '2020-01-01T00:00:00Z',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  it('süresi dolmuş token 403 alır ve sebebi AÇIKÇA söylenir', async () => {
    const res = await http(app)
      .post('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
      .set(supportReason('DESTEK-777 talep'))
      .send(newTenant('suresi-dolmus'));

    expect(res.status).toBe(403);
    // "Yetkin yok" demek, rotasyonu unutulmuş bir token ile çalınmış bir
    // token'ı aynı cevaba indirirdi.
    expect((res.body as Problem).title).toContain('süresi doldu');
  });

  it('süre dolumu YALNIZ platform uçlarını kapatır, API ayakta kalır', async () => {
    const res = await http(app).get('/healthz');
    expect(res.status).toBe(200);
  });
});
