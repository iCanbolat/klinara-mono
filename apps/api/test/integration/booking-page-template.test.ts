import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

interface ContentBody {
  draft: { revisionNumber: number } | null;
  published: { revisionNumber: number } | null;
  theme: Record<string, unknown>;
  sections: { type: string; title?: string; imageAssetId?: string; items?: { assetId: string }[] }[];
  seo: { title?: string; ogImageAssetId?: string };
}

interface AssetBody {
  id: string;
  purpose: string;
  url: string;
  status: string;
}

/**
 * Yeni kliniğin randevu sayfası HAZIR ŞABLONLA açılıyor.
 *
 * Diğer içerik testleri şablonu kapatıyor (`BOOKING_PAGE_TEMPLATE_ENABLED`),
 * çünkü boş sayfadan başlayan sözleşmeyi sınıyorlar. Burada açık.
 */
describe('randevu sayfası hazır şablonu', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PUBLIC_ASSET_BASE_URL: 'https://cdn.klinara.test',
        BOOKING_PAGE_TEMPLATE_ENABLED: 'true',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app, { slug: 'sablon-klinik' });
  });

  const ownerAuth = (): Record<string, string> => auth(clinic.owner.tokens);

  it('ilk açılışta şablon TASLAK olarak yazılıyor; yayınlanmıyor', async () => {
    const res = await http(app).get('/api/v1/booking-page/content').set(ownerAuth()).expect(200);
    const body = res.body as ContentBody;

    expect(body.draft?.revisionNumber).toBe(1);
    expect(body.published).toBeNull();
    expect(body.sections.map((section) => section.type)).toEqual([
      'hero',
      'richText',
      'carousel',
      'serviceList',
      'faq',
      'contact',
      'map',
    ]);
    // Kapak başlığı kliniğin kendi adı.
    expect(body.sections[0]?.title).toBe(clinic.tenant.name);
  });

  it('şablon görselleri kliniğin KENDİ kütüphanesine kopyalanıyor ve içerik onlara bağlı', async () => {
    const content = (
      await http(app).get('/api/v1/booking-page/content').set(ownerAuth()).expect(200)
    ).body as ContentBody;
    const assets = (
      await http(app).get('/api/v1/booking-page/assets').set(ownerAuth()).expect(200)
    ).body as AssetBody[];

    expect(assets).toHaveLength(5);
    expect(assets.every((asset) => asset.status === 'ready')).toBe(true);
    expect(assets.every((asset) => asset.url.includes(`/public/${clinic.tenant.id}/`))).toBe(true);

    const ids = new Set(assets.map((asset) => asset.id));
    const hero = content.sections[0];
    const gallery = content.sections.find((section) => section.type === 'carousel');
    expect(ids.has(hero?.imageAssetId ?? '')).toBe(true);
    expect(gallery?.items).toHaveLength(4);
    expect(gallery?.items?.every((item) => ids.has(item.assetId))).toBe(true);
    expect(content.seo.ogImageAssetId).toBe(hero?.imageAssetId);
  });

  it('şablon YALNIZ BİR KEZ yazılıyor — tekrar açılışta yeni sürüm ya da görsel yok', async () => {
    await http(app).get('/api/v1/booking-page/content').set(ownerAuth()).expect(200);
    await http(app).get('/api/v1/booking-page').set(ownerAuth()).expect(200);
    const again = (
      await http(app).get('/api/v1/booking-page/content').set(ownerAuth()).expect(200)
    ).body as ContentBody;
    const assets = (
      await http(app).get('/api/v1/booking-page/assets').set(ownerAuth()).expect(200)
    ).body as AssetBody[];

    expect(again.draft?.revisionNumber).toBe(1);
    expect(assets).toHaveLength(5);
  });

  it('şablon taslağı normal akışla düzenlenebiliyor (If-Match W/"1")', async () => {
    await http(app).get('/api/v1/booking-page/content').set(ownerAuth()).expect(200);
    const saved = await http(app)
      .put('/api/v1/booking-page/content')
      .set(ownerAuth())
      .set('If-Match', 'W/"1"')
      .send({ sections: [{ type: 'hero', title: 'Kendi başlığım' }] })
      .expect(200);
    expect((saved.body as ContentBody).draft?.revisionNumber).toBe(2);
  });
});
