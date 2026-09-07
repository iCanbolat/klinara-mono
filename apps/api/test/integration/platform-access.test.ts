import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { http, PLATFORM_TOKEN, supportReason } from '../helpers/identity';

interface Problem {
  code: string;
  status: number;
  title: string;
  detail?: string;
}

interface AccessRow {
  method: string;
  path: string;
  reason: string;
  request_id: string | null;
  token_expires_at: Date | null;
}

const newTenant = (slug: string) => ({
  slug,
  name: slug,
  branch: { slug: 'merkez', name: 'Merkez' },
  owner: { email: `sahip@${slug}.test`, fullName: 'Sahip' },
});

/**
 * Batch 10.3 — destek (platform) erişimi süreli ve kayıtlıdır.
 *
 * `PLATFORM_ADMIN_TOKEN` kiracı-üstü tek anahtardır: taşıyanı hiçbir kiracıya
 * ait olmadan kiracı açar ve RLS'in `app.platform_admin` bayrağını kaldırır.
 * 10.3 öncesinde bu erişimin ne süresi ne de izi vardı.
 */
describe('platform destek erişimi (Batch 10.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        // Uzak ama TANIMLI bir son kullanma tarihi.
        PLATFORM_ADMIN_TOKEN_NOT_AFTER: '2099-01-01T00:00:00Z',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
  });

  const accessRows = async (): Promise<AccessRow[]> => {
    const { rows } = await database.ownerPool.query<AccessRow>(
      'select method, path, reason, request_id, token_expires_at from platform_access_log order by id',
    );
    return rows;
  };

  it('gerekçeli çağrı çalışır ve erişim kaydı yazılır', async () => {
    const res = await http(app)
      .post('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
      .set(supportReason('DESTEK-123 numarali talep'))
      .set('x-request-id', 'destek-istegi-1')
      .send(newTenant('kayitli-klinik'));

    expect(res.status).toBe(201);

    const rows = await accessRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.method).toBe('POST');
    expect(rows[0]?.path).toBe('/api/v1/platform/tenants');
    expect(rows[0]?.reason).toBe('DESTEK-123 numarali talep');
    // İstek kimliği kayıtta: log, trace ve erişim kaydı tek id ile eşleşir.
    expect(rows[0]?.request_id).toBe('destek-istegi-1');
    expect(rows[0]?.token_expires_at).not.toBeNull();
  });

  it('GEREKÇESİZ çağrı reddedilir ve kiracı açılmaz', async () => {
    const res = await http(app)
      .post('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
      .send(newTenant('gerekcesiz-klinik'));

    expect(res.status).toBe(403);
    expect((res.body as Problem).detail).toContain('X-Support-Reason');

    const { rows } = await database.ownerPool.query('select id from tenants');
    expect(rows).toHaveLength(0);
  });

  it('anlamsız kısa gerekçe kabul edilmez', async () => {
    const res = await http(app)
      .post('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
      .set(supportReason('x'))
      .send(newTenant('kisa-gerekce'));
    expect(res.status).toBe(403);
  });

  it('reddedilen çağrı erişim kaydı BIRAKMAZ — kayıt yalnız gerçekleşen erişimindir', async () => {
    await http(app)
      .post('/api/v1/platform/tenants')
      .set('authorization', 'Bearer yanlis-token')
      .set(supportReason())
      .send(newTenant('yetkisiz'));

    expect(await accessRows()).toHaveLength(0);
  });

  it('erişim kaydı DEĞİŞTİRİLEMEZ ve SİLİNEMEZ', async () => {
    await http(app)
      .post('/api/v1/platform/tenants')
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`)
      .set(supportReason('DESTEK-999 inceleme'))
      .send(newTenant('kanit-klinik'));

    await expect(
      database.ownerPool.query("update platform_access_log set reason = 'baska'"),
    ).rejects.toThrow();
    await expect(database.ownerPool.query('delete from platform_access_log')).rejects.toThrow();
  });
});

