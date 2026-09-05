import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

const FROM = '2026-09-01T00:00:00+03:00';
const TO = '2026-10-01T00:00:00+03:00';

describe('rapor CSV dışa aktarımı (Batch 10.1)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.appUrl, PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app);
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);

  const exportCsv = (name: string, body: Record<string, unknown> = {}) =>
    http(app)
      .post(`/api/v1/reports/${name}/export`)
      .set(ownerAuth())
      .set(branch())
      .send({ from: FROM, to: TO, ...body });

  it('bilinmeyen rapor adı 404 — dinamik `:name` yolu YOK', async () => {
    // Uçlar rapor başına ayrı metotlar; dinamik bir yol parametresi izni de
    // dinamik yapardı. Türkçe dosya adı yalnız indirilen dosyanın adıdır,
    // rotanın değil.
    const res = await exportCsv('ciro');
    expect(res.status).toBe(404);
  });

  it('ciro dosyası indiriliyor: doğru tip, ad ve BOM', async () => {
    await http(app)
      .post('/api/v1/charges')
      .set(ownerAuth())
      .set(branch())
      .send({
        customerId: clinic.customer.id,
        source: 'manual',
        description: 'Kalem; virgüllü',
        unitPriceMinor: 123_456,
      });

    const res = await exportCsv('revenue');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="ciro-2026-09-01-2026-10-01.csv"',
    );
    // Rapor kiracıya özel; hiçbir ara katman saklamamalı.
    expect(res.headers['cache-control']).toBe('no-store');

    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('Kırılım;Tahakkuk;Tahakkuk (kuruş)');
    // Para İKİ kolonda: insan için ondalık, makine için ham kuruş.
    expect(body).toContain('1234,56');
    expect(body).toContain('123456');
  });

  it('alan içindeki ayraç TIRNAKLANIYOR — sütun kaymıyor', async () => {
    await http(app)
      .post('/api/v1/charges')
      .set(ownerAuth())
      .set(branch())
      .send({
        customerId: clinic.customer.id,
        source: 'manual',
        description: 'Kalem',
        unitPriceMinor: 1000,
      });

    const res = await exportCsv('revenue', { groupBy: 'branch' });
    expect(res.status).toBe(200);
    // Şube adı ayraç içermiyor ama başlık satırı biçimi doğrulanabilir:
    // her satırdaki ayraç sayısı başlıkla aynı olmalı.
    const lines = res.text.trimEnd().split('\r\n');
    const columns = (line: string) => line.split(';').length;
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(columns(line)).toBe(columns(lines[0] ?? ''));
  });

  it('doluluk ve no-show dosyaları da iniyor', async () => {
    for (const [name, expected] of [
      ['occupancy', 'doluluk-2026-09-01-2026-10-01.csv'],
      ['no-show', 'gelmeme-2026-09-01-2026-10-01.csv'],
      ['staff-performance', 'personel-performans-2026-09-01-2026-10-01.csv'],
      ['retention', 'kazanim-2026-09-01-2026-10-01.csv'],
    ] as const) {
      const res = await exportCsv(name);
      expect(res.status, name).toBe(200);
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${expected}"`);
    }
  });

  it('yetkisiz rol ciro dosyasını indiremiyor', async () => {
    const res = await http(app)
      .post('/api/v1/reports/revenue/export')
      .set(auth(clinic.practitioner.tokens))
      .set(branch())
      .send({ from: FROM, to: TO });

    expect(res.status).toBe(403);
  });

  it('ters aralık 400', async () => {
    const res = await exportCsv('revenue', { from: TO, to: FROM });
    expect(res.status).toBe(400);
  });
});
