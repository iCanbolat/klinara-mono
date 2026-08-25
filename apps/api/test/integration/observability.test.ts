import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildApp } from '../../src/app.js';
import { testEnv } from '../helpers/env.js';
import { AppError } from '../../src/lib/errors.js';
import { ERROR_CODES } from '@klinara/shared';

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

const LOG_MARKER = 'benzersiz-hata-izi-42';

describe('hata katmanı (RFC 9457)', () => {
  let app: FastifyInstance;
  const logs = collectingStream();

  beforeAll(async () => {
    app = await buildApp({
      env: testEnv({ LOG_LEVEL: 'info' }),
      logStream: logs.stream,
    });

    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/boom/bilinmeyen', { config: { public: true } }, async () => {
      throw new Error('veritabanı parolası hatalı: super_gizli_parola');
    });

    typed.get('/boom/bilinen', { config: { public: true } }, async () => {
      throw AppError.conflict(ERROR_CODES.SLOT_CONFLICT, 'Seçilen saat dolu', {
        detail: 'Ayşe Yılmaz 14:00-15:00 aralığında başka bir randevuda.',
        extra: { conflicts: [{ resourceType: 'staff', resourceId: 'abc' }] },
      });
    });

    typed.post(
      '/dogrula',
      {
        config: { public: true },
        schema: { body: z.object({ email: z.string().min(3), age: z.number().int().min(0) }) },
      },
      async () => ({ ok: true }),
    );

    typed.get('/boom/izli', { config: { public: true } }, async () => {
      throw new Error(LOG_MARKER);
    });

    typed.get('/log-sizinti', { config: { public: true } }, async (request) => {
      request.log.info(
        { password: 'gizli123', phone: '+905321234567', token: 'tok_abc' },
        'hassas alanlar içeren log',
      );
      return { ok: true };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('bilinen hata doğru code, status ve ek alanlarla döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/bilinen' });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');

    const body = res.json<Problem & { conflicts: unknown[] }>();
    expect(body.code).toBe('SLOT_CONFLICT');
    expect(body.status).toBe(409);
    expect(body.title).toBe('Seçilen saat dolu');
    expect(body.type).toBe('https://errors.klinara.app/slot-conflict');
    expect(body.instance).toBe('/boom/bilinen');
    expect(body.requestId).toBeTruthy();
    expect(body.conflicts).toHaveLength(1);
  });

  it('beklenmeyen hata 500 döner ve İÇ AYRINTIYI SIZDIRMAZ', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom/bilinmeyen' });
    expect(res.statusCode).toBe(500);

    const raw = res.body;
    expect(raw).not.toContain('super_gizli_parola');
    expect(raw).not.toContain('veritabanı parolası');
    expect(raw).not.toContain('at Object.');
    expect(raw).not.toContain('.ts:');

    const body = res.json<Problem>();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.requestId).toBeTruthy();
  });

  it('beklenmeyen hatanın ayrıntısı LOGA düşer (kaybolmaz)', async () => {
    await app.inject({ method: 'GET', url: '/boom/izli' });
    expect(logs.text()).toContain(LOG_MARKER);
  });

  it('yanıttaki requestId ile logdaki reqId aynıdır', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/boom/bilinmeyen',
      headers: { 'x-request-id': 'izlenebilir-id-777' },
    });
    expect(res.json<Problem>().requestId).toBe('izlenebilir-id-777');
    expect(res.headers['x-request-id']).toBe('izlenebilir-id-777');
    expect(logs.text()).toContain('izlenebilir-id-777');
  });

  it('doğrulama hatası alan bazlı 400 döner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dogrula',
      payload: { email: 'a', age: -1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<Problem>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.length).toBeGreaterThanOrEqual(2);
    expect(body.errors?.map((e) => e.path).sort()).toEqual(['age', 'email']);
  });

  it('tanımsız uç için 404 problem belgesi döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/boyle-bir-uc-yok' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json<Problem>().code).toBe('NOT_FOUND');
  });

  it('sırlar loglanmaz, telefon maskelenir', async () => {
    logs.lines.length = 0;
    await app.inject({ method: 'GET', url: '/log-sizinti' });
    const text = logs.text();

    expect(text).not.toContain('gizli123');
    expect(text).not.toContain('tok_abc');
    expect(text).not.toContain('+905321234567');
    expect(text).toContain('[GİZLENDİ]');
    // Telefon tamamen silinmez, son iki hane destek için kalır.
    expect(text).toContain('67');
  });
});

describe('metrikler ve doküman', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      env: testEnv({ METRICS_TOKEN: 'cok-gizli-metrik-tokeni' }),
      loggerOverride: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/metrics token olmadan 401 döner', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(401);
    expect(res.json<Problem>().code).toBe('UNAUTHENTICATED');
  });

  it('/metrics yanlış token ile 401 döner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer yanlis-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('/metrics doğru token ile Prometheus formatı döner', async () => {
    await app.inject({ method: 'GET', url: '/healthz' });
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer cok-gizli-metrik-tokeni' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_request_duration_seconds');
    expect(res.body).toContain('klinara_appointments_created_total');
    expect(res.body).toContain('process_cpu_user_seconds_total');
  });

  it('metrikler ham URL değil ROTA şablonu ile etiketlenir', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer cok-gizli-metrik-tokeni' },
    });
    expect(res.body).toContain('route="/healthz"');
  });

  it('/openapi.json Zod şemalarından üretilir', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ info: { title: string }; paths: Record<string, unknown> }>();
    expect(doc.info.title).toBe('Klinara API');
    expect(Object.keys(doc.paths)).toContain('/healthz');
    expect(Object.keys(doc.paths)).toContain('/readyz');
    // /metrics `hide: true` ile dokümandan çıkarılmıştır.
    expect(Object.keys(doc.paths)).not.toContain('/metrics');
  });

  it('/docs arayüzü sunulur', async () => {
    const redirect = await app.inject({ method: 'GET', url: '/docs' });
    expect([200, 301, 302]).toContain(redirect.statusCode);
    const page = await app.inject({ method: 'GET', url: '/docs/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Klinara API');
  });
});
