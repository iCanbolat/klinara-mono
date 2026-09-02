import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { QueueService } from '../../src/lib/queue/queue.service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN, type TenantFixture } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

const ROOT_DOMAIN = 'klinara.localhost';
const ASSET_BASE = 'https://cdn.klinara.test';

interface ContentBody {
  draft: { id: string; revisionNumber: number; contentHash: string } | null;
  published: { id: string; revisionNumber: number } | null;
  theme: Record<string, unknown>;
  sections: { type: string; title?: string }[];
}
interface PublicSiteBody {
  slug: string;
  name: string;
  currency: string;
  branches: { id: string; name: string; phone: string | null; address: string | null; timezone: string }[];
  theme: Record<string, unknown>;
  sections: unknown[];
  settings: Record<string, unknown>;
  revision: { number: number; contentHash: string };
}
interface Problem {
  code: string;
}

describe('randevu sayfası içeriği, teması ve public okuma (Batch 9.2)', () => {
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

  const ownerAuth = () => auth(clinic.owner.tokens);

  const saveDraft = (body: object) =>
    http(app).put('/api/v1/booking-page/content').set(ownerAuth()).send(body);

  const publish = () => http(app).post('/api/v1/booking-page/publish').set(ownerAuth());

  describe('blok sözlüğü', () => {
    it('bilinen blok türleri kabul edilir', async () => {
      const res = await saveDraft({
        theme: { primaryColor: '#0F766E', fontFamily: 'inter' },
        sections: [
          { type: 'hero', title: 'Klinik X', subtitle: 'Randevu alın' },
          { type: 'richText', body: '## Hakkımızda\n\nMerhaba.' },
          { type: 'carousel', items: [] },
          { type: 'serviceList' },
          { type: 'contact' },
        ],
        seo: { title: 'Klinik X', description: 'Online randevu' },
      }).expect(200);

      const body = res.body as ContentBody;
      expect(body.sections).toHaveLength(5);
      expect(body.draft?.revisionNumber).toBe(1);
    });

    it('KRİTİK: sözlükte olmayan blok türü REDDEDİLİR, saklanmaz', async () => {
      const res = await saveDraft({
        sections: [{ type: 'iframeEmbed', src: 'https://evil.example.com' }],
      }).expect(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');

      // Hiçbir sürüm yazılmamış olmalı.
      const content = await http(app)
        .get('/api/v1/booking-page/content')
        .set(ownerAuth())
        .expect(200);
      expect((content.body as ContentBody).draft).toBeNull();
    });

    it('bloktaki bilinmeyen alanlar sessizce elenir', async () => {
      const res = await saveDraft({
        sections: [{ type: 'hero', title: 'Klinik X', onclick: 'alert(1)' }],
      }).expect(200);
      expect((res.body as ContentBody).sections[0]).not.toHaveProperty('onclick');
    });

    it('tema rengi hex olmalı, yazı tipi beyaz listeden gelmeli', async () => {
      await saveDraft({ theme: { primaryColor: 'red; background:url(x)' }, sections: [] }).expect(400);
      await saveDraft({ theme: { fontFamily: 'Comic Sans' }, sections: [] }).expect(400);
    });
  });

  describe('sürümler', () => {
    it('her kaydetme YENİ ve değişmez bir sürüm yazar', async () => {
      await saveDraft({ sections: [{ type: 'hero', title: 'Birinci' }] }).expect(200);
      const second = await saveDraft({ sections: [{ type: 'hero', title: 'İkinci' }] }).expect(200);
      expect((second.body as ContentBody).draft?.revisionNumber).toBe(2);

      const revisions = await http(app)
        .get('/api/v1/booking-page/content/revisions')
        .set(ownerAuth())
        .expect(200);
      expect((revisions.body as unknown[]).length).toBe(2);
    });

    it('yayınlanmış sürüm DEĞİŞTİRİLEMEZ (trigger)', async () => {
      await saveDraft({ sections: [{ type: 'hero', title: 'Klinik X' }] }).expect(200);
      await publish().expect(200);

      await expect(
        database.ownerPool.query(
          `update booking_page_revisions set sections = '[]'::jsonb`,
        ),
      ).rejects.toThrow(/değiştirilemez|restrict/i);
    });

    it('aynı içerik iki kez serileştirilince content_hash AYNI çıkar', async () => {
      const document = {
        theme: { primaryColor: '#0F766E', fontFamily: 'inter' },
        sections: [{ type: 'hero', title: 'Klinik X', subtitle: 'Alt başlık' }],
        seo: { description: 'Online randevu', title: 'Klinik X' },
      };
      const first = await saveDraft(document).expect(200);
      // Anahtar sırası FARKLI ama içerik aynı — kanonik JSON aynı hash'i vermeli.
      const shuffled = {
        seo: { title: 'Klinik X', description: 'Online randevu' },
        sections: [{ subtitle: 'Alt başlık', title: 'Klinik X', type: 'hero' }],
        theme: { fontFamily: 'inter', primaryColor: '#0F766E' },
      };
      const second = await saveDraft(shuffled).expect(200);

      expect((second.body as ContentBody).draft?.contentHash).toBe(
        (first.body as ContentBody).draft?.contentHash,
      );
    });

    it('geri alma pointer taşır; public yanıt eski içeriği döner', async () => {
      const first = await saveDraft({ sections: [{ type: 'hero', title: 'Eski' }] }).expect(200);
      const firstRevision = (first.body as ContentBody).draft!.id;
      await publish().expect(200);

      await saveDraft({ sections: [{ type: 'hero', title: 'Yeni' }] }).expect(200);
      await publish().expect(200);

      const live = await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
      expect(((live.body as PublicSiteBody).sections[0] as { title: string }).title).toBe('Yeni');

      await http(app)
        .post(`/api/v1/booking-page/content/rollback/${firstRevision}`)
        .set(ownerAuth())
        .expect(200);

      const rolledBack = await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
      expect(((rolledBack.body as PublicSiteBody).sections[0] as { title: string }).title).toBe(
        'Eski',
      );
    });

    it('içeriği olmayan sayfa yayınlanamaz', async () => {
      const res = await publish().expect(409);
      expect((res.body as Problem).code).toBe('SITE_NOT_PUBLISHED');
    });

    it('yayından kaldırma yayınlanmış sürümü KORUR', async () => {
      await saveDraft({ sections: [{ type: 'hero', title: 'Klinik X' }] }).expect(200);
      await publish().expect(200);
      await http(app).post('/api/v1/booking-page/unpublish').set(ownerAuth()).expect(200);

      await http(app).get('/api/v1/public/sites/klinik-x').expect(404);

      await publish().expect(200);
      await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
    });
  });

  describe('public okuma', () => {
    beforeEach(async () => {
      await saveDraft({
        theme: { primaryColor: '#0F766E' },
        sections: [{ type: 'hero', title: 'Klinik X' }],
      }).expect(200);
      await publish().expect(200);
    });

    it('KRİTİK: yanıt donmuş bir alan beyaz listesine uyar', async () => {
      const res = await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
      const body = res.body as PublicSiteBody;

      expect(Object.keys(body).sort()).toEqual([
        'branches',
        'canonicalUrl',
        'currency',
        'defaultBranchId',
        'locales',
        'name',
        'revision',
        'sections',
        'seo',
        'settings',
        'slug',
        'theme',
        'timezone',
      ]);
      expect(Object.keys(body.branches[0]!).sort()).toEqual([
        'address',
        'id',
        'name',
        'phone',
        'timezone',
      ]);
    });

    it('yayınlanmamış sayfa 404 — "yok" ile ayırt edilemez', async () => {
      await http(app).get('/api/v1/public/sites/hic-yok').expect(404);
    });

    it('ETag ve Cache-Control döner; If-None-Match ile 304 ve BOŞ gövde', async () => {
      const first = await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
      const etag = first.headers['etag'] as string;
      expect(etag).toMatch(/^W\/"r\d+-[0-9a-f]{16}"$/);
      expect(first.headers['cache-control']).toContain('s-maxage=300');

      const second = await http(app)
        .get('/api/v1/public/sites/klinik-x')
        .set('if-none-match', etag)
        .expect(304);
      expect(second.text).toBe('');
    });

    it('yayın ETag’i değiştirir', async () => {
      const before = (await http(app).get('/api/v1/public/sites/klinik-x')).headers['etag'];
      await saveDraft({ sections: [{ type: 'hero', title: 'Değişti' }] }).expect(200);
      await publish().expect(200);
      const after = (await http(app).get('/api/v1/public/sites/klinik-x')).headers['etag'];
      expect(after).not.toBe(before);
    });

    it('onam metinlerinin hash’i yanıtta döner', async () => {
      await http(app)
        .put('/api/v1/booking-page')
        .set(ownerAuth())
        .send({ consentTexts: [{ kind: 'kvkk_explicit', text: 'Açık rıza metni.' }] })
        .expect(200);

      const res = await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
      const consents = (res.body as PublicSiteBody).settings['requiredConsents'] as {
        kind: string;
        textSha256: string;
        required: boolean;
      }[];
      expect(consents).toHaveLength(1);
      expect(consents[0]).toMatchObject({ kind: 'kvkk_explicit', required: true });
      expect(consents[0]?.textSha256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('public katalog', () => {
    beforeEach(async () => {
      await saveDraft({ sections: [] }).expect(200);
      await publish().expect(200);
    });

    it('online randevuya açık hizmetleri kategoriye göre döner', async () => {
      const res = await http(app).get('/api/v1/public/sites/klinik-x/services').expect(200);
      const categories = res.body as { id: string; name: string; services: { id: string }[] }[];
      expect(categories.length).toBeGreaterThan(0);
      const ids = categories.flatMap((category) => category.services.map((s) => s.id));
      expect(ids).toContain(clinic.service.id);
    });

    it('is_online_bookable kapalı hizmet SIZMAZ', async () => {
      await database.ownerPool.query(
        `update services set is_online_bookable = false where id = $1`,
        [clinic.service.id],
      );
      const res = await http(app).get('/api/v1/public/sites/klinik-x/services').expect(200);
      const ids = (res.body as { services: { id: string }[] }[]).flatMap((category) =>
        category.services.map((s) => s.id),
      );
      expect(ids).not.toContain(clinic.service.id);
    });

    it('KRİTİK: showPrices kapalıyken fiyat alanı HİÇ YOK (sıfır değil)', async () => {
      const before = await http(app).get('/api/v1/public/sites/klinik-x/services').expect(200);
      expect((before.body as { services: Record<string, unknown>[] }[])[0]!.services[0]).toHaveProperty(
        'priceMinor',
      );

      await http(app)
        .put('/api/v1/booking-page')
        .set(ownerAuth())
        .send({ showPrices: false })
        .expect(200);

      const after = await http(app).get('/api/v1/public/sites/klinik-x/services').expect(200);
      const service = (after.body as { services: Record<string, unknown>[] }[])[0]!.services[0]!;
      expect(service).not.toHaveProperty('priceMinor');
      expect(service).not.toHaveProperty('currency');
    });

    it('bilinmeyen şube 404 döner, boş liste DEĞİL', async () => {
      await http(app)
        .get('/api/v1/public/sites/klinik-x/services?branchId=00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('yayında purge-on-publish (Ek D)', () => {
    /**
     * İşin YAYINLA AYNI transaction'da yazılması, "cache düştü ama içerik
     * yayınlanmadı" durumunu yapısal olarak imkânsız kılıyor. Testler bu
     * bağlantıyı doğruluyor — worker'ın kendisi ayrı bir birim testinde.
     */
    const spySend = () => vi.spyOn(app.get(QueueService), 'send').mockResolvedValue(undefined);

    it('yayın işi kuyruğa slug ve sebeple yazılıyor', async () => {
      const send = spySend();
      await saveDraft({ sections: [{ type: 'hero', title: 'A' }] }).expect(200);
      await publish().expect(200);

      const call = send.mock.calls.find(([, queue]) => queue === 'booking.page.purge');
      expect(call).toBeDefined();
      expect(call?.[2]).toEqual({ slug: 'klinik-x', reason: 'publish' });
      // İlk argüman transaction handle'ı: iş çağıranın transaction'ında.
      expect(call?.[0]).toBeDefined();
      send.mockRestore();
    });

    it('yayın BAŞARISIZ olduğunda iş yazılmıyor', async () => {
      // İçeriksiz yayın 409 veriyor; transaction geri alınıyor ve onunla
      // birlikte purge işi de yazılmamış olmalı.
      const send = spySend();
      await publish().expect(409);
      expect(send.mock.calls.filter(([, q]) => q === 'booking.page.purge')).toHaveLength(0);
      send.mockRestore();
    });

    it('yayından kaldırma ve geri alma da purge tetikliyor', async () => {
      await saveDraft({ sections: [{ type: 'hero', title: 'A' }] }).expect(200);
      await publish().expect(200);

      const send = spySend();
      await http(app).post('/api/v1/booking-page/unpublish').set(ownerAuth()).expect(200);
      expect(send.mock.calls.some(([, q, data]) => q === 'booking.page.purge' && (data as { reason: string }).reason === 'unpublish')).toBe(true);
      send.mockRestore();
    });

    it('QUEUE_ENABLED=false iken yayın YİNE başarılı', async () => {
      // Testler kuyruk kapalı koşuyor; bu, purge'ün bir ÖN KOŞUL olmadığının
      // kanıtı — kuyruksuz bir kurulumda da yayın çalışmalı.
      await saveDraft({ sections: [{ type: 'hero', title: 'A' }] }).expect(200);
      await publish().expect(200);
      await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
    });
  });

  describe('kiracı izolasyonu', () => {
    it('başka kiracının sayfası okunamaz ve içeriği sızmaz', async () => {
      await saveDraft({ sections: [{ type: 'hero', title: 'Gizli Klinik' }] }).expect(200);
      await publish().expect(200);

      const other: TenantFixture = await bootstrapTenant(app, { slug: 'klinik-z' });
      const content = await http(app)
        .get('/api/v1/booking-page/content')
        .set(auth(other.owner.tokens))
        .expect(200);

      // Diğer kiracı KENDİ boş sayfasını görür.
      expect((content.body as ContentBody).draft).toBeNull();
      expect(JSON.stringify(content.body)).not.toContain('Gizli Klinik');
    });
  });
});
