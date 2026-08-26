import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Secret, TOTP } from 'otpauth';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  http,
  inviteMember,
  login,
  PLATFORM_TOKEN,
  type TenantFixture,
  type Tokens,
} from '../helpers/identity';

interface Problem {
  code: string;
  status: number;
}

/** Kullanıcının authenticator uygulamasının yaptığını yapar. */
function codeFor(secret: string, offsetSteps = 0): string {
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
  return totp.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

describe('iki adımlı doğrulama ve oturumlar (Batch 1.4)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let fixture: TenantFixture;

  const enableTotp = async (tokens: Tokens): Promise<{ secret: string; backupCodes: string[] }> => {
    const setup = await http(app).post('/api/v1/auth/2fa/setup').set(auth(tokens)).send({});
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    const secret = (setup.body as { secret: string }).secret;

    const enabled = await http(app)
      .post('/api/v1/auth/2fa/enable')
      .set(auth(tokens))
      .send({ code: codeFor(secret) });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);

    return { secret, backupCodes: (enabled.body as { backupCodes: string[] }).backupCodes };
  };

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
    fixture = await bootstrapTenant(app, { slug: 'iki-adim', name: 'İki Adım Kliniği' });
  });

  // -------------------------------------------------------------------------
  describe('kurulum', () => {
    it('TOTP varsayılan olarak KAPALIDIR', async () => {
      const status = await http(app).get('/api/v1/auth/2fa').set(auth(fixture.owner.tokens));
      expect(status.status).toBe(200);
      expect((status.body as { enabled: boolean }).enabled).toBe(false);
    });

    it('setup → enable akışı yedek kodları bir kez döner', async () => {
      const setup = await http(app)
        .post('/api/v1/auth/2fa/setup')
        .set(auth(fixture.owner.tokens))
        .send({});
      expect(setup.status).toBe(200);
      const body = setup.body as { secret: string; otpauthUri: string };
      expect(body.otpauthUri).toContain('otpauth://totp/');
      expect(body.otpauthUri).toContain('Klinara');

      // Doğrulanmadan 2FA AÇIK sayılmaz.
      const midway = await http(app).get('/api/v1/auth/2fa').set(auth(fixture.owner.tokens));
      expect((midway.body as { enabled: boolean }).enabled).toBe(false);

      const enabled = await http(app)
        .post('/api/v1/auth/2fa/enable')
        .set(auth(fixture.owner.tokens))
        .send({ code: codeFor(body.secret) });
      expect(enabled.status).toBe(200);
      expect((enabled.body as { backupCodes: string[] }).backupCodes).toHaveLength(10);

      const after = await http(app).get('/api/v1/auth/2fa').set(auth(fixture.owner.tokens));
      expect(after.body as { enabled: boolean; backupCodesRemaining: number }).toEqual({
        enabled: true,
        backupCodesRemaining: 10,
      });
    });

    it('yanlış kod kurulumu tamamlamaz', async () => {
      const setup = await http(app)
        .post('/api/v1/auth/2fa/setup')
        .set(auth(fixture.owner.tokens))
        .send({});
      const res = await http(app)
        .post('/api/v1/auth/2fa/enable')
        .set(auth(fixture.owner.tokens))
        .send({ code: '000000' });

      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('MFA_INVALID');
      void setup;
    });

    it('TOTP sırrı veritabanında ŞİFRELİ durur (ham SQL anlamsız okur)', async () => {
      const { secret } = await enableTotp(fixture.owner.tokens);

      const { rows } = await database.ownerPool.query<{
        secret_encrypted: string;
        key_id: string;
      }>('select secret_encrypted, key_id from user_totp_secrets');

      expect(rows).toHaveLength(1);
      expect(rows[0]?.secret_encrypted).not.toContain(secret);
      expect(rows[0]?.key_id).toBe('v1');
      // `<keyId>:<iv>:<tag>:<ciphertext>`
      expect(rows[0]?.secret_encrypted.split(':')).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  describe('girişin ikinci adımı', () => {
    it('2FA açıkken giriş TAM YETKİLİ token vermez', async () => {
      const { secret } = await enableTotp(fixture.owner.tokens);

      const first = await login(app, { email: fixture.owner.email });
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('mfa_required');
      expect(first.body.tokens).toBeUndefined();
      expect(first.body.mfa).toEqual({ configured: true, methods: ['totp', 'backup_code'] });

      // Ara token API'ye erişemez.
      const withChallenge = await http(app).get('/api/v1/me').set(auth(first.body.challengeToken!));
      expect(withChallenge.status).toBe(401);

      // Kurulumda kullanılan adım TÜKETİLMİŞTİR; bir sonraki pencerenin kodu
      // kullanılır (replay koruması bunu böyle gerektirir).
      const verified = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: first.body.challengeToken, code: codeFor(secret, 1) });

      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      const tokens = (verified.body as { tokens: Tokens }).tokens;
      expect((await http(app).get('/api/v1/me').set(auth(tokens))).status).toBe(200);
    });

    it('yanlış kod reddedilir', async () => {
      await enableTotp(fixture.owner.tokens);
      const first = await login(app, { email: fixture.owner.email });

      const res = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: first.body.challengeToken, code: '111111' });

      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('MFA_INVALID');
    });

    it('AYNI kod ikinci kez kabul edilmez (replay koruması)', async () => {
      const { secret } = await enableTotp(fixture.owner.tokens);
      const code = codeFor(secret, 1);

      const first = await login(app, { email: fixture.owner.email });
      const ok = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: first.body.challengeToken, code });
      expect(ok.status).toBe(200);

      const second = await login(app, { email: fixture.owner.email });
      const replay = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: second.body.challengeToken, code });

      expect(replay.status).toBe(400);
      expect((replay.body as Problem).code).toBe('MFA_INVALID');
    });

    it('±1 pencere toleransı vardır (kullanıcının saati geride)', async () => {
      const { secret } = await enableTotp(fixture.owner.tokens);
      // Kurulum bu adımı tüketti; eski bir girişi taklit etmek için sayacı
      // geriye alıyoruz — aksi hâlde replay koruması tolerans testini gölgeler.
      await database.ownerPool.query(
        'update user_totp_secrets set last_used_step = last_used_step - 5',
      );

      const first = await login(app, { email: fixture.owner.email });
      const res = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: first.body.challengeToken, code: codeFor(secret, -1) });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it('yedek kod TEK KULLANIMLIKTIR', async () => {
      const { backupCodes } = await enableTotp(fixture.owner.tokens);
      const code = backupCodes[0]!;

      const first = await login(app, { email: fixture.owner.email });
      const ok = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: first.body.challengeToken, code });
      expect(ok.status).toBe(200);

      // Oturumda yöntem "backup_code" olarak kaydedilir.
      const tokens = (ok.body as { tokens: Tokens }).tokens;
      const sessions = await http(app).get('/api/v1/auth/sessions').set(auth(tokens));
      const current = (
        sessions.body as { data: { current: boolean; mfaMethod: string }[] }
      ).data.find((s) => s.current);
      expect(current?.mfaMethod).toBe('backup_code');

      const second = await login(app, { email: fixture.owner.email });
      const reuse = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: second.body.challengeToken, code });
      expect(reuse.status).toBe(400);
    });

    it('yedek kodlar yenilendiğinde eskiler geçersizleşir', async () => {
      const { backupCodes } = await enableTotp(fixture.owner.tokens);

      const regenerated = await http(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .set(auth(fixture.owner.tokens))
        .send({});
      expect(regenerated.status).toBe(200);
      const fresh = (regenerated.body as { backupCodes: string[] }).backupCodes;
      expect(fresh).toHaveLength(10);
      expect(fresh).not.toContain(backupCodes[0]);

      const attempt = await login(app, { email: fixture.owner.email });
      const res = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: attempt.body.challengeToken, code: backupCodes[0] });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('kapatma', () => {
    it('geçerli kod olmadan 2FA kapatılamaz', async () => {
      await enableTotp(fixture.owner.tokens);

      const res = await http(app)
        .delete('/api/v1/auth/2fa')
        .set(auth(fixture.owner.tokens))
        .send({ code: '999999' });
      expect(res.status).toBe(400);

      const status = await http(app).get('/api/v1/auth/2fa').set(auth(fixture.owner.tokens));
      expect((status.body as { enabled: boolean }).enabled).toBe(true);
    });

    it('doğru kodla kapatılır', async () => {
      const { secret } = await enableTotp(fixture.owner.tokens);

      const res = await http(app)
        .delete('/api/v1/auth/2fa')
        .set(auth(fixture.owner.tokens))
        .send({ code: codeFor(secret, 1) });
      expect(res.status, JSON.stringify(res.body)).toBe(204);

      const after = await login(app, { email: fixture.owner.email });
      expect(after.body.status).toBe('authenticated');
    });
  });

  // -------------------------------------------------------------------------
  describe('kiracı zorunluluğu', () => {
    it('yöneticiler için zorunlu kılındığında kurulum akışına düşülür', async () => {
      const manager = await inviteMember(app, fixture.owner.tokens, {
        email: 'mudur@iki-adim.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      const settings = await http(app)
        .patch('/api/v1/tenant/settings')
        .set(auth(fixture.owner.tokens))
        .send({ requireMfaForAdmins: true });
      expect(settings.status).toBe(200);
      expect((settings.body as { requireMfaForAdmins: boolean }).requireMfaForAdmins).toBe(true);

      const attempt = await login(app, { email: 'mudur@iki-adim.test' });
      expect(attempt.body.status).toBe('mfa_required');
      // Henüz kurulum yapmamış: istemci kurulum ekranına yönlendirir.
      expect(attempt.body.mfa).toEqual({ configured: false, methods: ['totp'] });
      expect(attempt.body.tokens).toBeUndefined();

      // Ara token YALNIZ kurulum uçlarını açar.
      const challenge = attempt.body.challengeToken!;
      expect((await http(app).get('/api/v1/me').set(auth(challenge))).status).toBe(401);

      const setup = await http(app).post('/api/v1/auth/2fa/setup').set(auth(challenge)).send({});
      expect(setup.status).toBe(200);
      const secret = (setup.body as { secret: string }).secret;

      const enabled = await http(app)
        .post('/api/v1/auth/2fa/enable')
        .set(auth(challenge))
        .send({ code: codeFor(secret) });
      expect(enabled.status).toBe(200);

      // Kurulum TEK BAŞINA oturum açmaz; doğrulama şart.
      const verified = await http(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ challengeToken: challenge, code: codeFor(secret, 1) });
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      const tokens = (verified.body as { tokens: Tokens }).tokens;
      expect((await http(app).get('/api/v1/me').set(auth(tokens))).status).toBe(200);

      void manager;
    });

    it('zorunluluk yalnız YÖNETİCİ rollerini kapsar', async () => {
      await inviteMember(app, fixture.owner.tokens, {
        email: 'resepsiyon@iki-adim.test',
        roleKey: 'receptionist',
        branchId: fixture.branch.id,
      });
      await http(app)
        .patch('/api/v1/tenant/settings')
        .set(auth(fixture.owner.tokens))
        .send({ requireMfaForAdmins: true });

      const attempt = await login(app, { email: 'resepsiyon@iki-adim.test' });
      expect(attempt.body.status).toBe('authenticated');
    });
  });
});
