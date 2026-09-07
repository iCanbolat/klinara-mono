import { Writable } from 'node:stream';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  http,
  DEFAULT_PASSWORD,
  PLATFORM_TOKEN,
  type TenantFixture,
} from '../helpers/identity';

/**
 * Batch 10.3 — sır ve kişisel veri sızıntı taraması.
 *
 * Mevcut redaction testi SENTETİKTİR: özel bir probe ucu bilerek hassas alanlar
 * loglar ve gizlendiğini doğrular. Buradaki iddia farklı ve daha zor: GERÇEK
 * bir trafik akışı (kiracı açma, davet kabulü, giriş, hatalı giriş, müşteri ve
 * tıbbi not yazma, randevu erişim token'ıyla okuma) tek bir log akışına
 * toplanır ve akışın TAMAMI bilinen sırlara karşı taranır.
 *
 * Fark önemli: gizlemenin işe yaraması, hassas verinin loga hangi YOLDAN
 * girdiğine bağlıdır. Alan adı üzerinden girerse `redact` yakalar; URL'in
 * içinden girerse yakalamaz. İkinci yolu ancak gerçek trafik gösterir.
 */

/** Log satırlarını biriktiren akış — `createTestApp` pino'ya bunu verir. */
function collectingStream() {
  const lines: string[] = [];
  return {
    lines,
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
    text: () => lines.join('\n'),
  };
}

const CUSTOMER_PHONE = '+905321234567';
const MEDICAL_NOTE = 'Hastada lidokain alerjisi var; işlem öncesi antihistaminik verildi.';

describe('sır ve kişisel veri sızıntı taraması (Batch 10.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let tenant: TenantFixture;
  const logs = collectingStream();

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      // Tarama en gürültülü seviyede koşar: `info` ile geçen bir gizleme,
      // üretimde `debug` açıldığı gün kırılabilirdi.
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        LOG_LEVEL: 'debug',
      },
      logStream: logs.stream,
    });

    tenant = await bootstrapTenant(app, { slug: 'sizinti-klinik' });

    // Başarılı ve BAŞARISIZ giriş: ikincisinde parola bir hata bağlamının
    // içinde loglanmaya en yakın olduğu andır.
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: tenant.owner.email, password: DEFAULT_PASSWORD });
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: tenant.owner.email, password: 'yanlis-parola-42' });

    const customer = await http(app)
      .post('/api/v1/customers')
      .set(auth(tenant.owner.tokens))
      .send({ fullName: 'Ayşe Yılmaz', phone: CUSTOMER_PHONE, email: 'ayse@klinik.test' });
    expect(customer.status).toBe(201);
    const customerId = (customer.body as { id: string }).id;

    const note = await http(app)
      .post(`/api/v1/customers/${customerId}/notes`)
      .set(auth(tenant.owner.tokens))
      .send({ body: MEDICAL_NOTE, kind: 'treatment' });
    expect(note.status).toBe(201);

    // Opaque token TAŞIYAN bir URL: yol parçası olarak gelir, gövde değildir.
    // (Token geçersiz — önemli olan 404 yolunun da loglanması.)
    await http(app).get(
      '/api/v1/public/sites/sizinti-klinik/appointments/F2xJ8kQ1sN0pR7tV3wY6zA9bC4dE5fG8hI1jK2lM3nO',
    );
    await http(app).get('/uploads/local/get?key=musteri/dosya.jpg&sig=imza-degeri-burada');
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  it('log akışı gerçekten dolu — boş bir akışta her tarama yeşil görünür', () => {
    expect(logs.lines.length).toBeGreaterThan(5);
    expect(logs.text()).toContain('"req"');
  });

  it('parolalar hiçbir biçimde loglanmaz', () => {
    const text = logs.text();
    expect(text).not.toContain(DEFAULT_PASSWORD);
    expect(text).not.toContain('yanlis-parola-42');
  });

  it('platform token’ı ve oturum token’ları loglanmaz', () => {
    const text = logs.text();
    expect(text).not.toContain(PLATFORM_TOKEN);
    expect(text).not.toContain(tenant.owner.tokens.accessToken);
    expect(text).not.toContain(tenant.owner.tokens.refreshToken);
  });

  it('URL’in içinde taşınan opaque token loga DÜZ METİN girmez', () => {
    const text = logs.text();
    expect(text).not.toContain('F2xJ8kQ1sN0pR7tV3wY6zA9bC4dE5fG8hI1jK2lM3nO');
    expect(text).not.toContain('sig=imza-degeri-burada');
    // Yolun kendisi kaybolmamalı: gizleme iz sürmeyi bitirmemeli.
    expect(text).toContain('/api/v1/public/sites/sizinti-klinik/appointments/');
  });

  it('müşteri telefonu ham hâlde loglanmaz', () => {
    expect(logs.text()).not.toContain(CUSTOMER_PHONE);
  });

  it('tıbbi not gövdesi loglanmaz — sağlık verisi için kural gizleme değil, hiç yazmamaktır', () => {
    const text = logs.text();
    expect(text).not.toContain(MEDICAL_NOTE);
    expect(text).not.toContain('lidokain');
  });

  it('hata yanıtları sır veya iç ayrıntı taşımaz', async () => {
    const res = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: tenant.owner.email, password: 'baska-yanlis-parola' });
    expect(res.status).toBe(401);
    expect(res.text).not.toContain('baska-yanlis-parola');
    expect(res.text).not.toContain('.ts:');
    // Kullanıcı sayımı (user enumeration): var olmayan hesap AYNI cevabı verir.
    const unknown = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'yok@klinik.test', password: 'baska-yanlis-parola' });
    expect(unknown.status).toBe(res.status);
    expect((unknown.body as { code: string }).code).toBe((res.body as { code: string }).code);
  });
});
