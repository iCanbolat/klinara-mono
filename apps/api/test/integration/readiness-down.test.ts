import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';

/**
 * Erişilemeyen bir veritabanı ayrı bir dosyada test edilir: `ConfigModule`
 * ortamı modül yüklenirken bir kez okur, dolayısıyla "bozuk DATABASE_URL"
 * senaryosu kendi süreç izolasyonunu gerektirir.
 */
describe('bağımlılık düştüğünde', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      env: { DATABASE_URL: 'postgres://nobody:nope@127.0.0.1:1/nothing' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/readyz 503 döner (süreç ölmez)', async () => {
    const res = await request(app.getHttpServer()).get('/readyz');
    expect(res.status).toBe(503);
    expect((res.body as { checks: { database: string } }).checks.database).toBe('down');
  });

  it('/healthz etkilenmez — DB düşmesi süreci yeniden başlatma sebebi değildir', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
  });
});
