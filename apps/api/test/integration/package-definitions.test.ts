import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

interface DefinitionItem {
  id: string;
  serviceId: string;
  serviceName: string;
  quantity: number;
  unitListPriceMinor: number;
  sortOrder: number;
}

interface DefinitionBody {
  id: string;
  slug: string;
  name: string;
  branchId: string | null;
  totalPriceMinor: number;
  listPriceMinor: number;
  validityDays: number | null;
  isTransferable: boolean;
  isActive: boolean;
  revision: number;
  version: number;
  items: DefinitionItem[];
  deletedAt: string | null;
}

interface DefinitionPage {
  data: DefinitionBody[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

describe('paket tanımları (Batch 5.1)', () => {
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

  /** 10 lazer (150000) + 2 bakım (50000) = liste 1.600.000, satış 1.200.000. */
  const createDefinition = async (overrides: Record<string, unknown> = {}) => {
    const response = await http(app)
      .post('/api/v1/package-definitions')
      .set(ownerAuth())
      .send({
        slug: 'lazer-10-bakim-2',
        name: '10 Seans Lazer + 2 Bakım',
        totalPriceMinor: 1_200_000,
        validityDays: 365,
        items: [
          { serviceId: clinic.service.id, quantity: 10 },
          { serviceId: clinic.quickService.id, quantity: 2 },
        ],
        ...overrides,
      });
    return response;
  };

  it('çok kalemli paket tanımı oluşturur ve liste fiyatını hesaplar', async () => {
    const created = await createDefinition();
    expect(created.status).toBe(201);

    const body = created.body as DefinitionBody;
    expect(body.items).toHaveLength(2);
    expect(body.totalPriceMinor).toBe(1_200_000);
    // 10 × 150000 + 2 × 50000 — indirim bu ikisinin farkından okunur.
    expect(body.listPriceMinor).toBe(1_600_000);
    expect(body.revision).toBe(1);
    expect(body.version).toBe(1);
    expect(created.headers.etag).toBe('W/"1"');

    const detail = await http(app)
      .get(`/api/v1/package-definitions/${body.id}`)
      .set(ownerAuth());
    expect(detail.status).toBe(200);
    expect(detail.headers.etag).toBe('W/"1"');
    expect((detail.body as DefinitionBody).items.map((item) => item.quantity)).toEqual([10, 2]);
  });

  it('aynı slug ikinci kez kullanılamaz', async () => {
    expect((await createDefinition()).status).toBe(201);
    const duplicate = await createDefinition({ name: 'Kopya' });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { code: string }).code).toBe('CONFLICT');
  });

  it('aynı hizmet iki kalemde tekrarlanamaz', async () => {
    const response = await createDefinition({
      items: [
        { serviceId: clinic.service.id, quantity: 10 },
        { serviceId: clinic.service.id, quantity: 5 },
      ],
    });
    expect(response.status).toBe(400);
    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('pasif hizmet pakete eklenemez', async () => {
    await http(app)
      .patch(`/api/v1/services/${clinic.quickService.id}`)
      .set(ownerAuth())
      .send({ isActive: false })
      .expect(200);

    const response = await createDefinition();
    expect(response.status).toBe(422);
  });

  it('If-Match olmadan güncellenemez, eski sürümle çakışır', async () => {
    const definition = (await createDefinition()).body as DefinitionBody;

    const missing = await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .send({ name: 'Yeni ad' });
    expect(missing.status).toBe(428);

    const first = await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ name: 'Yeni ad' });
    expect(first.status).toBe(200);
    expect((first.body as DefinitionBody).version).toBe(2);

    const stale = await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ name: 'Daha yeni ad' });
    expect(stale.status).toBe(409);
    expect((stale.body as { code: string }).code).toBe('VERSION_CONFLICT');
  });

  it('fiyat değişimi revizyonu artırır, ad değişimi artırmaz', async () => {
    const definition = (await createDefinition()).body as DefinitionBody;

    const renamed = await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ name: 'Sadece ad' });
    expect((renamed.body as DefinitionBody).revision).toBe(1);

    const repriced = await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"2"')
      .send({ totalPriceMinor: 1_300_000 });
    expect((repriced.body as DefinitionBody).revision).toBe(2);
  });

  it('kalem listesi PATCH ile tamamen değiştirilir', async () => {
    const definition = (await createDefinition()).body as DefinitionBody;

    const updated = await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ items: [{ serviceId: clinic.quickService.id, quantity: 4 }] });

    expect(updated.status).toBe(200);
    const items = (updated.body as DefinitionBody).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.serviceId).toBe(clinic.quickService.id);
    expect((updated.body as DefinitionBody).listPriceMinor).toBe(200_000);
  });

  it('satılmamış tanım DELETE ile arşivlenir ve listeden düşer', async () => {
    const definition = (await createDefinition()).body as DefinitionBody;

    await http(app)
      .delete(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .expect(204);

    await http(app)
      .get(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .expect(404);

    const list = await http(app).get('/api/v1/package-definitions').set(ownerAuth());
    expect((list.body as DefinitionPage).data).toHaveLength(0);
  });

  it('isActive ve serviceId filtreleri çalışır', async () => {
    const definition = (await createDefinition()).body as DefinitionBody;
    await createDefinition({
      slug: 'sadece-bakim',
      name: 'Sadece Bakım',
      items: [{ serviceId: clinic.quickService.id, quantity: 3 }],
    });

    await http(app)
      .patch(`/api/v1/package-definitions/${definition.id}`)
      .set(ownerAuth())
      .set('if-match', 'W/"1"')
      .send({ isActive: false })
      .expect(200);

    const active = await http(app)
      .get('/api/v1/package-definitions?isActive=true')
      .set(ownerAuth());
    expect((active.body as DefinitionPage).data.map((row) => row.slug)).toEqual(['sadece-bakim']);

    const byService = await http(app)
      .get(`/api/v1/package-definitions?serviceId=${clinic.service.id}`)
      .set(ownerAuth());
    expect((byService.body as DefinitionPage).data.map((row) => row.slug)).toEqual([
      'lazer-10-bakim-2',
    ]);
  });

  it('başka kiracının tanımı görünmez (RLS)', async () => {
    const definition = (await createDefinition()).body as DefinitionBody;

    const other = await setupClinic(app, { slug: 'ikinci-klinik' });
    const response = await http(app)
      .get(`/api/v1/package-definitions/${definition.id}`)
      .set(auth(other.owner.tokens));
    expect(response.status).toBe(404);

    // Aynı slug başka kiracıda serbest.
    const sameSlug = await http(app)
      .post('/api/v1/package-definitions')
      .set(auth(other.owner.tokens))
      .send({
        slug: 'lazer-10-bakim-2',
        name: 'Aynı slug, başka kiracı',
        totalPriceMinor: 100_000,
        items: [{ serviceId: other.service.id, quantity: 1 }],
      });
    expect(sameSlug.status).toBe(201);
  });

  it('başka kiracının hizmeti kaleme eklenemez', async () => {
    const other = await setupClinic(app, { slug: 'ucuncu-klinik' });
    const response = await createDefinition({
      items: [{ serviceId: other.service.id, quantity: 1 }],
    });
    expect(response.status).toBe(422);
  });
});
