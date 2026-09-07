import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { http } from '../helpers/identity';
import { ProbeController } from '../helpers/probe.controller';

interface Problem {
  code: string;
  status: number;
  detail?: string;
}

/** `{"a":{"a":{…}}}` — verilen derinlikte iç içe nesne. */
function nested(depth: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < depth; level += 1) value = { a: value };
  return value;
}

/**
 * Batch 10.3 — gövde boyutu VE biçimi.
 *
 * Bayt sınırı (`BODY_LIMIT_BYTES`) Faz 0'dan beri vardı; ölçtüğü şey yalnızca
 * boyut. Bu testin gösterdiği açık şu: birkaç KB'lik bir gövde binlerce
 * seviye derin olabilir ve onu gezen HER özyinelemeli kod (doğrulama,
 * dönüştürme, serileştirme) o derinlikte çalışır.
 */
describe('gövde sınırları (Batch 10.3)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      env: { BODY_LIMIT_BYTES: '4096', BODY_MAX_DEPTH: '10', BODY_MAX_ARRAY_LENGTH: '50' },
      controllers: [ProbeController],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('sınırın altındaki normal gövde kabul edilir', async () => {
    const res = await http(app).post('/api/v1/dogrula').send({ email: 'ayse@k.test', age: 30 });
    expect(res.status).toBe(201);
  });

  it('bayt sınırını aşan gövde 413 döner ve RFC 9457 sözleşmesine uyar', async () => {
    const res = await http(app)
      .post('/api/v1/dogrula')
      .send({ email: 'a'.repeat(8_000), age: 1 });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
  });

  it('KÜÇÜK ama ÇOK DERİN gövde reddedilir — bayt sınırı bunu görmez', async () => {
    const payload = JSON.stringify(nested(200));
    // Boyut sınırının çok altında: sorun boyut değil, biçim.
    expect(payload.length).toBeLessThan(4_096);

    const res = await http(app)
      .post('/api/v1/dogrula')
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    expect((res.body as Problem).detail).toContain('İç içe geçme sınırı');
  });

  it('sınırı aşan dizi reddedilir', async () => {
    const res = await http(app)
      .post('/api/v1/dogrula')
      .send({ email: 'ayse@k.test', age: 1, tags: Array.from({ length: 200 }, () => 'x') });

    expect(res.status).toBe(400);
    expect((res.body as Problem).detail).toContain('Dizi uzunluğu sınırı');
  });

  it('sınıra EŞİT derinlik hâlâ kabul edilir — kontrol bir eksiğe kaymamalı', async () => {
    const res = await http(app)
      .post('/api/v1/dogrula')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: 'ayse@k.test', age: 1, nested: nested(8) }));
    expect(res.status).toBe(201);
  });
});
