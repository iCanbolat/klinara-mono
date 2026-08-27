import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';
import { ThumbnailWorker } from '../../src/modules/files/thumbnail.worker';
import { MemoryObjectStorage } from '../../src/lib/storage/memory.storage';
import { OBJECT_STORAGE } from '../../src/lib/storage/storage.types';

interface Problem {
  code: string;
  status: number;
}

interface PresignBody {
  storageKey: string;
  uploadUrl: string;
  contentType: string;
}

interface FileRow {
  thumbnail_key: string | null;
  status: string;
}

interface FileBody {
  id: string;
  kind: string;
  position: string;
  sizeBytes: number;
  sha256: string | null;
  hasThumbnail: boolean;
}

/** Küçük ama GERÇEK bir PNG — sharp'ın çözebilmesi gerekiyor. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('müşteri dosyaları (Batch 4.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;
  let receptionist: { userId: string; tokens: Tokens };

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
    receptionist = await inviteMember(app, clinic.owner.tokens, {
      email: 'resepsiyon@demo-klinik.test',
      roleKey: 'receptionist',
      branchId: clinic.branch.id,
    });
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const deskAuth = () => auth(receptionist.tokens);
  const customer = () => clinic.customer.id;

  const presign = (body: Record<string, unknown> = {}, as = ownerAuth()) =>
    http(app)
      .post('/api/v1/uploads/presign')
      .set(as)
      .send({
        customerId: customer(),
        contentType: 'image/png',
        sizeBytes: PNG_1x1.byteLength,
        kind: 'photo',
        ...body,
      });

  /** presign → istemci doğrudan yükler → confirm. */
  const upload = async (
    options: { content?: Buffer; kind?: string; sha256?: string | null; confirm?: object } = {},
    as = ownerAuth(),
  ) => {
    const content = options.content ?? PNG_1x1;
    const kind = options.kind ?? 'photo';

    const signed = await presign(
      { kind, sizeBytes: content.byteLength, contentType: 'image/png' },
      as,
    ).expect(200);
    const { storageKey, uploadUrl, contentType } = signed.body as PresignBody;

    await http(app).put(uploadUrl).set('content-type', contentType).send(content).expect(200);

    const sha256 =
      options.sha256 === null
        ? undefined
        : (options.sha256 ?? createHash('sha256').update(content).digest('hex'));

    return http(app)
      .post(`/api/v1/customers/${customer()}/files`)
      .set(as)
      .send({ storageKey, kind, ...(sha256 === undefined ? {} : { sha256 }), ...options.confirm });
  };

  // -------------------------------------------------------------------------
  describe('presign → yükleme → confirm', () => {
    it('dosyayı kaydeder ve üstveriyi SUNUCUDA doğrular', async () => {
      const res = await upload();
      expect(res.status).toBe(201);
      const body = res.body as FileBody;
      expect(body.kind).toBe('photo');
      // Boyut istemcinin beyanından değil, nesnenin kendisinden okundu.
      expect(body.sizeBytes).toBe(PNG_1x1.byteLength);
      expect(body.hasThumbnail).toBe(false);
    });

    it('yükleme YAPILMADAN confirm reddedilir', async () => {
      const signed = await presign().expect(200);
      const res = await http(app)
        .post(`/api/v1/customers/${customer()}/files`)
        .set(ownerAuth())
        .send({ storageKey: (signed.body as PresignBody).storageKey, kind: 'photo' });

      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('aynı anahtar iki kez kaydedilemez', async () => {
      const content = PNG_1x1;
      const signed = await presign({ sizeBytes: content.byteLength }).expect(200);
      const { storageKey, uploadUrl, contentType } = signed.body as PresignBody;
      await http(app).put(uploadUrl).set('content-type', contentType).send(content).expect(200);

      await http(app)
        .post(`/api/v1/customers/${customer()}/files`)
        .set(ownerAuth())
        .send({ storageKey, kind: 'photo' })
        .expect(201);

      const second = await http(app)
        .post(`/api/v1/customers/${customer()}/files`)
        .set(ownerAuth())
        .send({ storageKey, kind: 'photo' });
      expect(second.status).toBe(409);
    });

    it('BAŞKA müşterinin anahtarı bu müşteriye bağlanamaz', async () => {
      const other = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth())
        .send({ fullName: 'Diğer Müşteri' })
        .expect(201);
      const otherId = (other.body as { id: string }).id;

      const signed = await presign({ customerId: otherId }).expect(200);
      const res = await http(app)
        .post(`/api/v1/customers/${customer()}/files`)
        .set(ownerAuth())
        .send({ storageKey: (signed.body as PresignBody).storageKey, kind: 'photo' });

      expect(res.status).toBe(403);
    });

    it('izin verilmeyen MIME tipi reddedilir', async () => {
      const res = await presign({ contentType: 'image/svg+xml' });
      expect(res.status).toBe(400);
    });

    it('üst sınırı aşan boyut reddedilir', async () => {
      const res = await presign({ sizeBytes: 200 * 1024 * 1024 });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('görünürlük ve erişim kaydı', () => {
    it('resepsiyon klinik FOTOĞRAFINI ne listeler ne indirir', async () => {
      const photo = await upload();
      expect(photo.status).toBe(201);
      const photoId = (photo.body as FileBody).id;

      const document = await upload({ kind: 'document' }, deskAuth());
      expect(document.status).toBe(201);

      const list = await http(app)
        .get(`/api/v1/customers/${customer()}/files`)
        .set(deskAuth())
        .expect(200);
      const kinds = (list.body as { data: FileBody[] }).data.map((f) => f.kind);
      expect(kinds).toEqual(['document']);

      // Göremeyeceği dosya 404 döner, 403 değil.
      const download = await http(app)
        .get(`/api/v1/files/${photoId}/download-url`)
        .set(deskAuth());
      expect(download.status).toBe(404);
    });

    it('resepsiyon klinik fotoğrafı YÜKLEYEMEZ', async () => {
      const res = await presign({}, deskAuth());
      expect(res.status).toBe(403);
    });

    it('her download-url çağrısı erişim kaydına düşer', async () => {
      const created = await upload();
      const id = (created.body as FileBody).id;

      await http(app).get(`/api/v1/files/${id}/download-url`).set(ownerAuth()).expect(200);
      await http(app).get(`/api/v1/files/${id}/download-url`).set(ownerAuth()).expect(200);

      const rows = await database.ownerPool.query(
        'select action, resource_type, actor_user_id from customer_record_access_log',
      );
      expect(rows.rowCount).toBe(2);
      expect(rows.rows[0]).toMatchObject({ action: 'download', resource_type: 'file' });
    });

    it('indirme adresi gerçekten dosyayı veriyor', async () => {
      const created = await upload();
      const id = (created.body as FileBody).id;

      const res = await http(app)
        .get(`/api/v1/files/${id}/download-url`)
        .set(ownerAuth())
        .expect(200);
      const url = (res.body as { url: string }).url;

      const downloaded = await http(app).get(url).expect(200);
      expect(Buffer.from(downloaded.body as Buffer).equals(PNG_1x1)).toBe(true);
    });

    it('BAŞKA kiracının dosyası görünmez', async () => {
      const created = await upload();
      const id = (created.body as FileBody).id;

      const other = await setupClinic(app, { slug: 'klinik-b' });
      const res = await http(app).get(`/api/v1/files/${id}/download-url`).set(auth(other.owner.tokens));
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('gruplar', () => {
    it('öncesi/sonrası dosyaları grup altında döndürür', async () => {
      const group = await http(app)
        .post(`/api/v1/customers/${customer()}/file-groups`)
        .set(ownerAuth())
        .send({ title: 'Sağ kol — 3. seans', bodyArea: 'sağ kol' })
        .expect(201);
      const groupId = (group.body as { id: string }).id;

      expect((await upload({ confirm: { groupId, position: 'before' } })).status).toBe(201);
      expect((await upload({ confirm: { groupId, position: 'after' } })).status).toBe(201);

      const res = await http(app)
        .get(`/api/v1/customers/${customer()}/file-groups`)
        .set(ownerAuth())
        .expect(200);
      const groups = (res.body as { data: { files: FileBody[] }[] }).data;
      expect(groups).toHaveLength(1);
      expect(groups[0]?.files.map((f) => f.position).sort()).toEqual(['after', 'before']);
    });
  });

  // -------------------------------------------------------------------------
  describe('küçük görsel işi', () => {
    it('nesneyi küçültür ve satıra işler', async () => {
      const created = await upload();
      const id = (created.body as FileBody).id;

      // Kuyruk testte kapalı; worker doğrudan çağrılıyor.
      const worker = app.get(ThumbnailWorker);
      await worker.handle({ fileId: id, tenantId: clinic.tenant.id });

      const rows = await database.ownerPool.query<FileRow>(
        'select thumbnail_key, status from customer_files where id = $1',
        [id],
      );
      const row = rows.rows[0];
      expect(row?.thumbnail_key).toContain('-thumb.webp');
      expect(row?.status).toBe('ready');

      const storage = app.get<MemoryObjectStorage>(OBJECT_STORAGE);
      expect(await storage.get(row?.thumbnail_key ?? '')).toBeDefined();
    });

    it('sha256 UYUŞMAZSA dosya beklemede kalır', async () => {
      const created = await upload({ sha256: 'a'.repeat(64) });
      const id = (created.body as FileBody).id;

      const worker = app.get(ThumbnailWorker);
      await worker.handle({ fileId: id, tenantId: clinic.tenant.id });

      const rows = await database.ownerPool.query<FileRow>(
        'select thumbnail_key, status from customer_files where id = $1',
        [id],
      );
      expect(rows.rows[0]?.status).toBe('pending');
      expect(rows.rows[0]?.thumbnail_key).toBeNull();
    });

    it('kaydı olmayan iş sessizce biter', async () => {
      const worker = app.get(ThumbnailWorker);
      await expect(
        worker.handle({
          fileId: '00000000-0000-0000-0000-000000000000',
          tenantId: clinic.tenant.id,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
