import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic } from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
}

interface CategoryBody {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface ServiceBody {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  isActive: boolean;
  branchOverrides: {
    branchId: string;
    durationMinutes: number | null;
    priceMinor: number | null;
  }[];
}

describe('hizmet kataloğu', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

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
  });

  // -------------------------------------------------------------------------
  it('kategori ve hizmet zincirini uçtan uca kurar', async () => {
    const clinic = await setupClinic(app);

    expect(clinic.service.durationMinutes).toBe(60);
    expect(clinic.service.bufferBeforeMinutes).toBe(5);
    expect(clinic.service.bufferAfterMinutes).toBe(10);
    expect(clinic.service.priceMinor).toBe(150000);

    const list = await http(app).get('/api/v1/services').set(auth(clinic.owner.tokens));
    expect(list.status).toBe(200);
    expect((list.body as { data: ServiceBody[] }).data).toHaveLength(2);
  });

  it('aynı kiracıda slug tekrarını reddeder', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .post('/api/v1/service-categories')
      .set(auth(clinic.owner.tokens))
      .send({ slug: 'epilasyon', name: 'Epilasyon 2' });

    expect(res.status).toBe(409);
    expect((res.body as Problem).code).toBe('CONFLICT');
  });

  it('kullanımda olan kategori silinemez, hizmet pasife alınır', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    const blocked = await http(app)
      .delete(`/api/v1/service-categories/${clinic.category.id}`)
      .set(ownerAuth);
    expect(blocked.status).toBe(409);
    expect((blocked.body as Problem).code).toBe('CONFLICT');

    // "Silme" pasife almadır ve güncel kaydı döner — kayıt yok olmaz.
    for (const id of [clinic.service.id, clinic.quickService.id]) {
      const removed = await http(app).delete(`/api/v1/services/${id}`).set(ownerAuth);
      expect(removed.status).toBe(200);
      expect((removed.body as ServiceBody).isActive).toBe(false);
    }

    // Kategori aktif hizmet kalmadığı için artık pasife alınabilir.
    const freed = await http(app)
      .delete(`/api/v1/service-categories/${clinic.category.id}`)
      .set(ownerAuth);
    expect(freed.status).toBe(200);
    expect((freed.body as CategoryBody).isActive).toBe(false);
  });

  it('şube override’ı hizmetin kendi değerlerini ezer', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    const updated = await http(app)
      .patch(`/api/v1/services/${clinic.service.id}`)
      .set(ownerAuth)
      .send({
        branchOverrides: [
          { branchId: clinic.branch.id, durationMinutes: 90, priceMinor: 225000 },
        ],
      });

    expect(updated.status).toBe(200);
    const overrides = (updated.body as ServiceBody).branchOverrides;
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.branchId).toBe(clinic.branch.id);
    expect(overrides[0]?.durationMinutes).toBe(90);
    expect(overrides[0]?.priceMinor).toBe(225000);

    // Hizmetin kendi değeri değişmez — override yalnız o şubede kazanır.
    expect((updated.body as ServiceBody).durationMinutes).toBe(60);
  });

  it('bir kiracının kataloğu diğerinin context’inde ne okunur ne yazılır', async () => {
    const a = await setupClinic(app, { slug: 'klinik-a' });
    const b = await bootstrapTenant(app, { slug: 'klinik-b' });
    const bAuth = auth(b.owner.tokens);

    const list = await http(app).get('/api/v1/services').set(bAuth);
    expect(list.status).toBe(200);
    expect((list.body as { data: ServiceBody[] }).data).toHaveLength(0);

    const detail = await http(app).get(`/api/v1/services/${a.service.id}`).set(bAuth);
    expect(detail.status).toBe(404);

    const write = await http(app)
      .patch(`/api/v1/services/${a.service.id}`)
      .set(bAuth)
      .send({ name: 'Ele geçirildi' });
    expect(write.status).toBe(404);

    // A tarafında hiçbir şey değişmemiş olmalı.
    const untouched = await http(app)
      .get(`/api/v1/services/${a.service.id}`)
      .set(auth(a.owner.tokens));
    expect((untouched.body as ServiceBody).name).toBe('Tüm Vücut Lazer');
  });

  it('yazma izni olmayan rol katalogu değiştiremez', async () => {
    const clinic = await setupClinic(app);
    const reception = await inviteMember(app, clinic.owner.tokens, {
      email: 'resepsiyon@demo-klinik.test',
      roleKey: 'receptionist',
      branchId: clinic.branch.id,
    });

    const read = await http(app).get('/api/v1/services').set(auth(reception.tokens));
    expect(read.status).toBe(200);

    const write = await http(app)
      .post('/api/v1/service-categories')
      .set(auth(reception.tokens))
      .send({ slug: 'yeni-kategori', name: 'Yeni' });
    expect(write.status).toBe(403);
    expect((write.body as Problem).code).toBe('FORBIDDEN');
  });

  it('kategori listesi sıralama ve isim üzerinden döner', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    await http(app)
      .post('/api/v1/service-categories')
      .set(ownerAuth)
      .send({ slug: 'cilt-bakimi', name: 'Cilt Bakımı', sortOrder: 0 });

    const res = await http(app).get('/api/v1/service-categories').set(ownerAuth);
    const data = (res.body as { data: CategoryBody[] }).data;
    expect(data.map((c) => c.slug)).toEqual(['cilt-bakimi', 'epilasyon']);
  });
});
