import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  DEFAULT_PASSWORD,
  http,
  inviteMember,
  invite,
  login,
  PLATFORM_TOKEN,
  type TenantFixture,
  type Tokens,
} from '../helpers/identity';

interface Problem {
  code: string;
  status: number;
}

describe('kimlik doğrulama (Batch 1.2)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let fixture: TenantFixture;

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
    fixture = await bootstrapTenant(app, { slug: 'giris-klinigi', name: 'Giriş Kliniği' });
  });

  // -------------------------------------------------------------------------
  describe('e-posta ile giriş', () => {
    it('doğru bilgilerle oturum açar ve token çifti döner', async () => {
      const { status, body } = await login(app, { email: fixture.owner.email });

      expect(status).toBe(200);
      expect(body.status).toBe('authenticated');
      expect(body.tokens?.accessToken).toBeTypeOf('string');
      expect(body.tokens?.refreshToken).toBeTypeOf('string');
      expect(body.tokens?.expiresIn).toBe(900);
    });

    it('e-posta büyük/küçük harf duyarsızdır', async () => {
      const { status, body } = await login(app, {
        email: fixture.owner.email.toUpperCase(),
      });
      expect(status).toBe(200);
      expect(body.status).toBe('authenticated');
    });

    it('hatalı parola ile "kullanıcı var mı yok mu" bilgisi SIZMAZ', async () => {
      const wrongPassword = await login(app, {
        email: fixture.owner.email,
        password: 'kesinlikle-yanlis',
      });
      const unknownUser = await login(app, {
        email: 'hicboyle@biri-yok.test',
        password: 'kesinlikle-yanlis',
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      // Aynı kod, aynı başlık: iki durum ayırt edilemez. (`requestId` her
      // istekte farklıdır, karşılaştırma dışında tutulur.)
      const withoutRequestId = ({ requestId: _drop, ...rest }: Record<string, unknown>) => rest;
      expect(withoutRequestId(wrongPassword.body as unknown as Record<string, unknown>)).toEqual(
        withoutRequestId(unknownUser.body as unknown as Record<string, unknown>),
      );
    });

    it('yanıt SÜRESİ de bilgi sızdırmaz (sahte doğrulama)', async () => {
      const measure = async (email: string): Promise<number> => {
        const started = process.hrtime.bigint();
        await login(app, { email, password: 'yanlis-parola-123' });
        return Number(process.hrtime.bigint() - started) / 1e6;
      };

      // Her iki yolda da argon2 çalışır; ölçüm gürültülü olduğu için sınır geniş
      // tutuluyor — amaç "var olmayan kullanıcıda anında dönme"yi yakalamak.
      const known = await measure(fixture.owner.email);
      const unknown = await measure('yok@yok.test');
      const ratio = Math.max(known, unknown) / Math.max(Math.min(known, unknown), 0.001);
      expect(ratio).toBeLessThan(10);
    });

    it('e-posta ve telefonun ikisi birden gönderilirse reddedilir', async () => {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: fixture.owner.email, phone: '+905321234567', password: DEFAULT_PASSWORD });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('ikisi de gönderilmezse reddedilir', async () => {
      const res = await http(app).post('/api/v1/auth/login').send({ password: DEFAULT_PASSWORD });
      expect(res.status).toBe(400);
    });

    it('devre dışı hesap giriş yapamaz', async () => {
      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'pasif@klinik.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      const patch = await http(app)
        .patch(`/api/v1/users/${member.userId}`)
        .set(auth(fixture.owner.tokens))
        .send({ isActive: false });
      expect(patch.status).toBe(200);

      const { status, body } = await login(app, { email: 'pasif@klinik.test' });
      expect(status).toBe(403);
      expect((body as unknown as Problem).code).toBe('ACCOUNT_DISABLED');
    });
  });

  // -------------------------------------------------------------------------
  describe('telefon ile giriş', () => {
    it('DOĞRULANMAMIŞ numarayla giriş yapılamaz', async () => {
      // Numara eklendi ama kod doğrulanmadı.
      const start = await http(app)
        .post('/api/v1/auth/phone/start')
        .set(auth(fixture.owner.tokens))
        .send({ phone: '0532 111 22 33' });
      expect(start.status).toBe(200);

      const { status } = await login(app, { phone: '+905321112233' });
      // Doğrulanmamış numara kimlik değildir: "kullanıcı yok" ile aynı yanıt.
      expect(status).toBe(401);
    });

    it('geçersiz telefon biçimi 400 döner', async () => {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .send({ phone: '123', password: DEFAULT_PASSWORD });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('kiracı seçimi', () => {
    it('birden çok klinikte çalışan kullanıcı önce kiracı seçer', async () => {
      const other = await bootstrapTenant(app, { slug: 'ikinci-klinik', name: 'İkinci Klinik' });

      // Aynı e-postayı ikinci kliniğe davet et. Hesap zaten var: parola
      // DEĞİŞMEZ, yalnız üyelik eklenir.
      const accepted = await invite(app, other.owner.tokens, {
        email: fixture.owner.email,
        roleKey: 'receptionist',
        branchId: other.branch.id,
      });
      expect(accepted.status).toBe('membership_added');

      const { status, body } = await login(app, { email: fixture.owner.email });
      expect(status).toBe(200);
      expect(body.status).toBe('tenant_selection_required');
      expect(body.tokens).toBeUndefined();
      expect(body.tenants).toHaveLength(2);
      expect(body.challengeToken).toBeTypeOf('string');

      const selected = await http(app)
        .post('/api/v1/auth/tenant')
        .send({ challengeToken: body.challengeToken, tenantId: other.tenant.id });

      expect(selected.status).toBe(200);
      const tokens = (selected.body as { tokens: Tokens }).tokens;
      const me = await http(app).get('/api/v1/me').set(auth(tokens));
      expect((me.body as { tenantId: string }).tenantId).toBe(other.tenant.id);
      expect((me.body as { roles: string[] }).roles).toEqual(['receptionist']);
    });

    it('üyesi olmadığı kiracı seçilemez', async () => {
      const other = await bootstrapTenant(app, { slug: 'yabanci-klinik', name: 'Yabancı' });
      await invite(app, other.owner.tokens, {
        email: fixture.owner.email,
        roleKey: 'receptionist',
        branchId: other.branch.id,
      });
      const third = await bootstrapTenant(app, { slug: 'ucuncu-klinik', name: 'Üçüncü' });

      const { body } = await login(app, { email: fixture.owner.email });
      const res = await http(app)
        .post('/api/v1/auth/tenant')
        .send({ challengeToken: body.challengeToken, tenantId: third.tenant.id });

      expect(res.status).toBe(403);
    });

    it('ara token access token olarak KULLANILAMAZ', async () => {
      const other = await bootstrapTenant(app, { slug: 'ara-token', name: 'Ara' });
      await invite(app, other.owner.tokens, {
        email: fixture.owner.email,
        roleKey: 'receptionist',
        branchId: other.branch.id,
      });

      const { body } = await login(app, { email: fixture.owner.email });
      const res = await http(app).get('/api/v1/me').set(auth(body.challengeToken!));

      expect(res.status).toBe(401);
      expect((res.body as Problem).code).toBe('TOKEN_INVALID');
    });
  });

  // -------------------------------------------------------------------------
  describe('refresh rotation ve yeniden kullanım tespiti', () => {
    it('yenileme yeni bir token çifti üretir', async () => {
      const first = fixture.owner.tokens;
      const res = await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken });

      expect(res.status).toBe(200);
      const next = res.body as Tokens;
      expect(next.refreshToken).not.toBe(first.refreshToken);

      const me = await http(app).get('/api/v1/me').set(auth(next));
      expect(me.status).toBe(200);
    });

    it('AYNI refresh token ikinci kez kullanılırsa oturum ailesi KOMPLE iptal olur', async () => {
      const first = fixture.owner.tokens;
      const rotated = await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken });
      expect(rotated.status).toBe(200);
      const next = rotated.body as Tokens;

      // Çalınmış token yeniden geliyor.
      const reuse = await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken });
      expect(reuse.status).toBe(401);
      expect((reuse.body as Problem).code).toBe('TOKEN_INVALID');

      // Meşru istemcinin YENİ token'ı da artık çalışmaz: aile iptal edildi.
      const afterRevoke = await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: next.refreshToken });
      expect(afterRevoke.status).toBe(401);

      // Access token da yetki çözümlemesinde düşer (oturum iptal).
      const me = await http(app).get('/api/v1/me').set(auth(next));
      expect(me.status).toBe(401);
    });

    it('refresh token veritabanında DÜZ METİN saklanmaz', async () => {
      const { rows } = await database.ownerPool.query<{ token_hash: string }>(
        'select token_hash from refresh_tokens',
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.token_hash).not.toBe(fixture.owner.tokens.refreshToken);
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('bilinmeyen refresh token 401 döner', async () => {
      const res = await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'uydurma-token-degeri' });
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('çıkış', () => {
    it('logout bu oturumu kapatır', async () => {
      const res = await http(app).post('/api/v1/auth/logout').set(auth(fixture.owner.tokens));
      expect(res.status).toBe(204);

      const me = await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens));
      expect(me.status).toBe(401);

      const refresh = await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: fixture.owner.tokens.refreshToken });
      expect(refresh.status).toBe(401);
    });

    it('logout-all tüm oturumları düşürür ve token sürümünü artırır', async () => {
      const second = await login(app, { email: fixture.owner.email });
      const secondTokens = second.body.tokens!;

      const res = await http(app).post('/api/v1/auth/logout-all').set(auth(fixture.owner.tokens));
      expect(res.status).toBe(200);
      expect((res.body as { revokedSessions: number }).revokedSessions).toBeGreaterThanOrEqual(2);

      for (const tokens of [fixture.owner.tokens, secondTokens]) {
        const me = await http(app).get('/api/v1/me').set(auth(tokens));
        expect(me.status).toBe(401);
      }
    });

    it('oturum listesi ve tekil iptal çalışır', async () => {
      const second = await login(app, { email: fixture.owner.email });
      const secondTokens = second.body.tokens!;

      const list = await http(app).get('/api/v1/auth/sessions').set(auth(secondTokens));
      expect(list.status).toBe(200);
      const sessions = (list.body as { data: { id: string; current: boolean }[] }).data;
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);

      const other = sessions.find((s) => !s.current)!;
      const revoked = await http(app)
        .delete(`/api/v1/auth/sessions/${other.id}`)
        .set(auth(secondTokens));
      expect(revoked.status).toBe(204);

      const me = await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens));
      expect(me.status).toBe(401);
      // Kendi oturumu ayakta.
      expect((await http(app).get('/api/v1/me').set(auth(secondTokens))).status).toBe(200);
    });

    it('başka kullanıcının oturumu iptal edilemez', async () => {
      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'baskasi@klinik.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      const list = await http(app).get('/api/v1/auth/sessions').set(auth(member.tokens));
      const memberSession = (list.body as { data: { id: string }[] }).data[0]!;

      const res = await http(app)
        .delete(`/api/v1/auth/sessions/${memberSession.id}`)
        .set(auth(fixture.owner.tokens));
      expect(res.status).toBe(404);

      expect((await http(app).get('/api/v1/me').set(auth(member.tokens))).status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('kaba kuvvet koruması', () => {
    it('ardışık hatalı denemeden sonra hesap geçici olarak kilitlenir', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await login(app, { email: fixture.owner.email, password: 'yanlis' });
        expect(res.status).toBe(401);
      }

      const locked = await login(app, { email: fixture.owner.email, password: 'yanlis' });
      expect(locked.status).toBe(429);
      expect((locked.body as unknown as Problem).code).toBe('ACCOUNT_LOCKED');

      // DOĞRU parola bile kilit süresince kabul edilmez.
      const correct = await login(app, { email: fixture.owner.email });
      expect(correct.status).toBe(429);
    });

    it('kilit VAR OLMAYAN tanımlayıcıda da devreye girer (hesap sayımı engellenir)', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(app, { email: 'yok@yok.test', password: 'yanlis' });
      }
      const locked = await login(app, { email: 'yok@yok.test', password: 'yanlis' });
      expect(locked.status).toBe(429);
    });

    it('başarılı giriş hatalı deneme sayacını sıfırlar', async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await login(app, { email: fixture.owner.email, password: 'yanlis' });
      }
      expect((await login(app, { email: fixture.owner.email })).status).toBe(200);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const res = await login(app, { email: fixture.owner.email, password: 'yanlis' });
        expect(res.status).toBe(401);
      }
    });
  });
});
