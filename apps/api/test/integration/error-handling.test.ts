import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { LOG_MARKER, ProbeController } from '../helpers/probe.controller';

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  requestId: string;
  errors?: { path: string; message: string }[];
}

/** Log satırlarını toplayan yazılabilir akış. */
function collectingStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines, text: () => lines.join('\n') };
}

describe('hata katmanı (RFC 9457)', () => {
  let app: NestExpressApplication;
  const logs = collectingStream();

  beforeAll(async () => {
    app = await createTestApp({
      env: { LOG_LEVEL: 'info' },
      controllers: [ProbeController],
      logStream: logs.stream,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('bilinen hata doğru code, status ve ek alanlarla döner', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/bilinen');
    expect(res.status).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');

    const body = res.body as Problem & { conflicts: unknown[] };
    expect(body.code).toBe('SLOT_CONFLICT');
    expect(body.status).toBe(409);
    expect(body.title).toBe('Seçilen saat dolu');
    expect(body.type).toBe('https://errors.klinara.app/slot-conflict');
    expect(body.instance).toBe('/api/v1/boom/bilinen');
    expect(body.requestId).toBeTruthy();
    expect(body.conflicts).toHaveLength(1);
  });

  it('beklenmeyen hata 500 döner ve İÇ AYRINTIYI SIZDIRMAZ', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/bilinmeyen');
    expect(res.status).toBe(500);

    const raw = res.text;
    expect(raw).not.toContain('super_gizli_parola');
    expect(raw).not.toContain('veritabanı parolası');
    expect(raw).not.toContain('at Object.');
    expect(raw).not.toContain('.ts:');

    const body = res.body as Problem;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.requestId).toBeTruthy();
  });

  it('beklenmeyen hatanın ayrıntısı LOGA düşer (kaybolmaz)', async () => {
    await request(app.getHttpServer()).get('/api/v1/boom/izli');
    expect(logs.text()).toContain(LOG_MARKER);
  });

  it('yanıttaki requestId ile logdaki reqId aynıdır', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/boom/bilinmeyen')
      .set('x-request-id', 'izlenebilir-id-777');
    expect((res.body as Problem).requestId).toBe('izlenebilir-id-777');
    expect(res.headers['x-request-id']).toBe('izlenebilir-id-777');
    expect(logs.text()).toContain('izlenebilir-id-777');
  });

  it('doğrulama hatası alan bazlı 400 döner', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dogrula')
      .send({ email: 'a', age: -1 });
    expect(res.status).toBe(400);
    const body = res.body as Problem;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.length).toBeGreaterThanOrEqual(2);
    expect(body.errors?.map((e) => e.path).sort()).toEqual(['age', 'email']);
  });

  it('tanımsız uç için 404 problem belgesi döner', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boyle-bir-uc-yok');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect((res.body as Problem).code).toBe('NOT_FOUND');
  });

  it('sırlar loglanmaz, telefon maskelenir', async () => {
    logs.lines.length = 0;
    await request(app.getHttpServer()).get('/api/v1/log-sizinti');
    const text = logs.text();

    expect(text).not.toContain('gizli123');
    expect(text).not.toContain('tok_abc');
    expect(text).not.toContain('+905321234567');
    expect(text).toContain('[GİZLENDİ]');
    // Telefon tamamen silinmez, son iki hane destek için kalır.
    expect(text).toContain('67');
  });
});
