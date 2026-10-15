import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN, supportReason } from '../helpers/identity';
import { GraphMock } from '../helpers/whatsapp';

const TOKEN = 'EAAG-platform-kurulum-tokeni-7c2d';
const platform = () => ({ authorization: `Bearer ${PLATFORM_TOKEN}`, ...supportReason() });

const credentials = {
  wabaId: '102290129340398',
  phoneNumberId: '106540352242922',
  businessPhone: '+905321112233',
  accessToken: TOKEN,
  appSecret: 'webhook-imza-sirri',
};

/**
 * Elden kurulum: platform yöneticisi kiracının WABA'sını klinik hesabıyla
 * giriş yapmadan kurar. Klinik ekranıyla AYNI servis, kiracıya daraltılmış
 * bağlamda koşar.
 */
describe('platform WhatsApp kurulumu', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  const graph = new GraphMock();

  beforeAll(async () => {
    database = await startTestDatabase();
    const baseUrl = await graph.start();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PLATFORM_ADMIN_TOKEN_NOT_AFTER: '2099-01-01T00:00:00Z',
        WHATSAPP_API_BASE_URL: baseUrl,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await graph.stop();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    graph.reset();
  });

  it('kimlik bilgisini yazar, doğrular; klinik aynı hesabı görür ve token maskelidir', async () => {
    const clinic = await bootstrapTenant(app, { slug: 'waba-klinik' });
    const other = await bootstrapTenant(app, { slug: 'baska-klinik' });
    const base = `/api/v1/platform/tenants/${clinic.tenant.id}/whatsapp`;

    const empty = await http(app).get(base).set(platform());
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ account: null, templates: [] });

    const saved = await http(app).put(base).set(platform()).send(credentials);
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
    expect((saved.body as { status: string }).status).toBe('unconfigured');

    const verified = await http(app).post(`${base}/verify`).set(platform());
    expect(verified.status).toBe(200);
    expect((verified.body as { ok: boolean }).ok).toBe(true);

    // Klinik kendi ekranında aynı, doğrulanmış hesabı görür.
    const seen = await http(app)
      .get('/api/v1/integrations/whatsapp')
      .set(auth(clinic.owner.tokens));
    expect((seen.body as { status: string; wabaId: string }).status).toBe('active');
    expect((seen.body as { wabaId: string }).wabaId).toBe(credentials.wabaId);

    // Başka kiracıya sızmaz.
    const otherSeen = await http(app)
      .get('/api/v1/integrations/whatsapp')
      .set(auth(other.owner.tokens));
    expect(otherSeen.status).toBe(200);
    expect((otherSeen.body as { wabaId?: string } | null)?.wabaId).toBeUndefined();

    // Kurulum listesinde WhatsApp adımı tamamlanır.
    const detail = await http(app)
      .get(`/api/v1/platform/tenants/${clinic.tenant.id}`)
      .set(platform());
    const steps = (detail.body as { setup: { steps: { key: string; done: boolean }[] } }).setup
      .steps;
    expect(steps.find((s) => s.key === 'whatsapp')?.done).toBe(true);
  });

  it('hesap yokken şablon gönderimi 422 WHATSAPP_NOT_CONFIGURED', async () => {
    const clinic = await bootstrapTenant(app, { slug: 'sablonsuz' });
    const res = await http(app)
      .post(`/api/v1/platform/tenants/${clinic.tenant.id}/whatsapp/templates/provision`)
      .set(platform());
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('WHATSAPP_NOT_CONFIGURED');
  });

  it('bilinmeyen kiracı 404; gerekçesiz çağrı 403; klinik token’ı reddedilir', async () => {
    const clinic = await bootstrapTenant(app, { slug: 'yetki-klinik' });
    const missing = await http(app)
      .get('/api/v1/platform/tenants/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b/whatsapp')
      .set(platform());
    expect(missing.status).toBe(404);

    const noReason = await http(app)
      .get(`/api/v1/platform/tenants/${clinic.tenant.id}/whatsapp`)
      .set('authorization', `Bearer ${PLATFORM_TOKEN}`);
    expect(noReason.status).toBe(403);

    const asClinic = await http(app)
      .put(`/api/v1/platform/tenants/${clinic.tenant.id}/whatsapp`)
      .set(auth(clinic.owner.tokens))
      .send(credentials);
    expect([401, 403]).toContain(asClinic.status);
  });
});
