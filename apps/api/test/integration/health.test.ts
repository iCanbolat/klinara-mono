import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';

describe('GET /healthz', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('gerçek port açmadan çağrılabilir ve 200 döner', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof (res.body as { uptimeSeconds: unknown }).uptimeSeconds).toBe('number');
  });

  it('güvenlik başlıklarını gönderir (helmet)', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('her isteğe benzersiz bir request id verir', async () => {
    const [a, b] = await Promise.all([
      request(app.getHttpServer()).get('/healthz'),
      request(app.getHttpServer()).get('/healthz'),
    ]);
    expect(a.headers['x-request-id']).toBeDefined();
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('yanıt gövdesinde yalnızca sözleşmedeki alanlar bulunur', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(Object.keys(res.body as object).sort()).toEqual(['status', 'uptimeSeconds']);
  });

  it('sağlık ucu /api/v1 önekinin DIŞINDADIR', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/healthz');
    expect(res.status).toBe(404);
  });
});

describe('request id propagasyonu', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('istemcinin gönderdiği x-request-id korunur', async () => {
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('x-request-id', 'istemci-tarafindan-uretilen-id');
    expect(res.headers['x-request-id']).toBe('istemci-tarafindan-uretilen-id');
  });

  it('aşırı uzun x-request-id kabul edilmez, yerine yeni id üretilir', async () => {
    const res = await request(app.getHttpServer())
      .get('/healthz')
      .set('x-request-id', 'x'.repeat(500));
    expect(res.headers['x-request-id']).not.toBe('x'.repeat(500));
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
