import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';

const METRICS_TOKEN = 'cok-gizli-metrik-tokeni';

describe('metrikler ve doküman', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ env: { METRICS_TOKEN } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/metrics token olmadan 401 döner', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('/metrics yanlış token ile 401 döner', async () => {
    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('authorization', 'Bearer yanlis-token');
    expect(res.status).toBe(401);
  });

  it('/metrics doğru token ile Prometheus formatı döner', async () => {
    await request(app.getHttpServer()).get('/healthz');
    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('authorization', `Bearer ${METRICS_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('klinara_appointments_created_total');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('metrikler ham URL değil ROTA ŞABLONU ile etiketlenir', async () => {
    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('authorization', `Bearer ${METRICS_TOKEN}`);
    expect(res.text).toContain('route="/healthz"');
  });

  it('/openapi.json controller ve DTO tanımlarından üretilir', async () => {
    const res = await request(app.getHttpServer()).get('/openapi.json');
    expect(res.status).toBe(200);
    const doc = res.body as {
      info: { title: string };
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.info.title).toBe('Klinara API');
    expect(Object.keys(doc.paths)).toContain('/healthz');
    expect(Object.keys(doc.paths)).toContain('/readyz');
    expect(Object.keys(doc.paths)).toContain('/api/v1/tenant');
    // DTO şemaları dokümana girer — sözleşme koddan üretiliyor.
    expect(Object.keys(doc.components.schemas)).toContain('TenantResponseDto');
    // /metrics `@ApiExcludeEndpoint()` ile dokümandan çıkarılmıştır.
    expect(Object.keys(doc.paths)).not.toContain('/metrics');
  });

  it('/docs arayüzü sunulur', async () => {
    const page = await request(app.getHttpServer()).get('/docs');
    expect([200, 301, 302]).toContain(page.status);
    const followed = page.status === 200 ? page : await request(app.getHttpServer()).get('/docs/');
    expect(followed.status).toBe(200);
    expect(followed.text).toContain('Klinara API');
  });
});
