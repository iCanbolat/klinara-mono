import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

const ROOT_DOMAIN = 'klinara.localhost';
const ASSET_BASE = 'https://cdn.klinara.test';

interface ContentBody {
  draft: { id: string; revisionNumber: number } | null;
  published: { id: string; revisionNumber: number } | null;
}
interface SiteView {
  slug: string;
  name: string;
  sections: { type: string; title?: string }[];
  revision: { number: number; contentHash: string };
  canonicalUrl: string;
  branches: { id: string }[];
}
interface Problem {
  code: string;
}

/**
 * Batch 11.5 — taslak önizleme ucu.
 *
 * Bu dosyanın ASIL testi "önizleme = yayın" iddiası: yayınlanmış bir revizyonun
 * önizlemesi, public ucun aynı revizyon için döndüğü gövdeyle deep-equal olmak
 * zorunda. Bu iddia olmasaydı iki sunum yolu zamanla sessizce ayrışır ve fark
 * ancak kullanıcı "önizlemede başkaydı" dediğinde ortaya çıkardı.
 */
describe('randevu sayfası taslak önizlemesi (Batch 11.5)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PUBLIC_BOOKING_DOMAIN: ROOT_DOMAIN,
        PUBLIC_ASSET_BASE_URL: ASSET_BASE,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app, { slug: 'klinik-x' });
  });

  const ownerAuth = (): Record<string, string> => auth(clinic.owner.tokens);
  const saveDraft = (body: object, ifMatch = 0) =>
    http(app)
      .put('/api/v1/booking-page/content')
      .set(ownerAuth())
      .set('If-Match', `W/"${String(ifMatch)}"`)
      .send(body);
  const preview = (query = '') =>
    http(app).get(`/api/v1/booking-page/preview${query}`).set(ownerAuth());

  it('taslak, YAYINLANMADAN önizlenebiliyor', async () => {
    await saveDraft({ sections: [{ type: 'hero', title: 'Taslak başlık' }] }).expect(200);

    const res = await preview().expect(200);
    const body = res.body as SiteView;
    expect(body.slug).toBe('klinik-x');
    expect(body.sections[0]?.title).toBe('Taslak başlık');
    expect(body.revision.number).toBe(1);

    // Public uç hâlâ yayınlanmamış görmeli — önizleme yayın DEĞİLDİR.
    await http(app).get('/api/v1/public/sites/klinik-x').expect(404);
  });

  it('KRİTİK: yayınlanmış bir sürümün önizlemesi public yanıtla AYNI', async () => {
    // "Önizlediğin şey yayınlanacak şeydir" garantisi. İki sunum yolunun
    // ayrışması, kullanıcının fark edeceği tek hata sınıfı.
    await saveDraft({
      theme: { primaryColor: '#0F766E', fontFamily: 'inter' },
      sections: [
        { type: 'hero', title: 'Klinik X', subtitle: 'Randevu alın' },
        { type: 'richText', body: '## Hakkımızda' },
        { type: 'contact' },
      ],
      seo: { title: 'Klinik X', description: 'Online randevu' },
    }).expect(200);
    await http(app).post('/api/v1/booking-page/publish').set(ownerAuth()).expect(200);

    const previewBody = (await preview().expect(200)).body as SiteView;
    const publicBody = (await http(app).get('/api/v1/public/sites/klinik-x').expect(200))
      .body as SiteView;

    expect(previewBody).toEqual(publicBody);
  });

  it('belirli bir sürüm `revisionId` ile önizlenebiliyor (sürüm geçmişi)', async () => {
    const first = (await saveDraft({ sections: [{ type: 'hero', title: 'Birinci' }] }).expect(200))
      .body as ContentBody;
    await saveDraft({ sections: [{ type: 'hero', title: 'İkinci' }] }, 1).expect(200);

    // Varsayılan taslak ikinci sürüm.
    expect(((await preview().expect(200)).body as SiteView).sections[0]?.title).toBe('İkinci');

    // Açıkça istenen eski sürüm.
    const older = (await preview(`?revisionId=${first.draft?.id ?? ''}`).expect(200))
      .body as SiteView;
    expect(older.sections[0]?.title).toBe('Birinci');
    expect(older.revision.number).toBe(1);
  });

  it('taslak CDN’e ASLA değmiyor — no-store', async () => {
    await saveDraft({ sections: [{ type: 'hero', title: 'X' }] }).expect(200);
    const res = await preview().expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['vary']).toContain('Authorization');
    // `s-maxage` bir ara cache'e "bunu tut" demektir; taslakta olamaz.
    expect(res.headers['cache-control'] ?? '').not.toContain('s-maxage');
  });

  it('hiç içerik yoksa BOŞ görünüm — 404 DEĞİL', async () => {
    // Editörün canlı önizlemesi bu görünümü taban alıyor (şubeler, ayarlar,
    // para birimi). 404 dönseydi yeni bir kiracı ilk kaydetmeye kadar hiçbir
    // şey göremezdi; oysa önizlemenin en çok gerektiği an tam da o an.
    const res = await preview().expect(200);
    const body = res.body as SiteView;
    expect(body.sections).toEqual([]);
    expect(body.revision).toEqual({ number: 0, contentHash: '' });
    expect(body.slug).toBe('klinik-x');
    expect(body.branches.length).toBeGreaterThan(0);
  });

  it('bilinmeyen revisionId 404 — var/yok ayrımı SIZDIRILMIYOR', async () => {
    await saveDraft({ sections: [{ type: 'hero', title: 'X' }] }).expect(200);
    const res = await preview('?revisionId=3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b').expect(404);
    expect((res.body as Problem).code).toBe('NOT_FOUND');
  });

  it('geçersiz biçimli revisionId 400', async () => {
    await preview('?revisionId=abc').expect(400);
  });

  it('booking_page:read olmayan kullanıcı ÖNİZLEYEMEZ', async () => {
    await saveDraft({ sections: [{ type: 'hero', title: 'X' }] }).expect(200);
    await http(app)
      .get('/api/v1/booking-page/preview')
      .set(auth(clinic.practitioner.tokens))
      .expect(403);
  });

  it('kimliksiz istek 401 — önizleme public DEĞİL', async () => {
    await http(app).get('/api/v1/booking-page/preview').expect(401);
  });
});
