import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { testEnv } from '../helpers/env.js';

describe('GET /healthz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv(), loggerOverride: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('gerçek port açmadan inject ile çağrılabilir ve 200 döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; uptimeSeconds: number }>();
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('güvenlik başlıklarını gönderir (helmet)', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('her isteğe benzersiz bir request id verir', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/healthz' }),
      app.inject({ method: 'GET', url: '/healthz' }),
    ]);
    expect(a.headers['x-request-id']).toBeDefined();
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('yanıt şeması Zod ile serileştirilir — fazladan alan sızmaz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(Object.keys(res.json()).sort()).toEqual(['status', 'uptimeSeconds']);
  });
});

describe('request id propagasyonu', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv(), loggerOverride: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('istemcinin gönderdiği x-request-id korunur', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'istemci-tarafindan-uretilen-id' },
    });
    expect(res.headers['x-request-id']).toBe('istemci-tarafindan-uretilen-id');
  });

  it('aşırı uzun x-request-id kabul edilmez, yerine yeni id üretilir', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'x'.repeat(500) },
    });
    expect(res.headers['x-request-id']).not.toBe('x'.repeat(500));
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
