import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { http } from '../helpers/identity';

const ALLOWED = 'https://panel.klinara.test';

/**
 * Batch 10.3 — CORS politikasının KANITI.
 *
 * Planın "CORS kiracı bazlı beyaz liste" maddesi, kiracıların özel alan
 * adlarının statik listeye sığmamasından doğmuştu. Mimari o ihtiyacı ortadan
 * kaldırdı: tarayıcı API'ye HİÇ doğrudan gitmiyor — hem `web-booking` hem
 * `web-admin` kendi Next sunucularının proxy'sinden geçiyor, yani istekler
 * aynı origin'den çıkıyor. Dinamik bir beyaz liste, olmayan bir ihtiyaç için
 * her preflight'ta veritabanına gitmek ve kiracı alan adlarına `credentials`
 * açmak demekti.
 *
 * Bu yüzden liste STATİK kaldı; buradaki testler o kararın koşullarını
 * kilitliyor: liste dışı bir origin cevap alamaz ve `Origin` başlığı asla
 * körü körüne yansıtılmaz.
 */
describe('CORS politikası (Batch 10.3)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ env: { CORS_ORIGINS: ALLOWED } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('listedeki origin için preflight izin verir', async () => {
    const res = await http(app)
      .options('/api/v1/me')
      .set('origin', ALLOWED)
      .set('access-control-request-method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('liste DIŞI origin izin başlığı ALMAZ', async () => {
    const res = await http(app)
      .options('/api/v1/me')
      .set('origin', 'https://saldirgan.example')
      .set('access-control-request-method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('gerçek istekte de origin yansıtılmaz', async () => {
    const res = await http(app).get('/api/v1/me').set('origin', 'https://saldirgan.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('yanıt `Vary: Origin` taşır — ara cache iki origin’in cevabını karıştıramaz', async () => {
    const res = await http(app).get('/api/v1/me').set('origin', ALLOWED);
    expect(res.headers['vary']).toContain('Origin');
  });
});
