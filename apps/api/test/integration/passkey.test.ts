import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  http,
  inviteMember,
  PLATFORM_TOKEN,
  type TenantFixture,
  type Tokens,
} from '../helpers/identity';
import { SoftwareAuthenticator } from '../helpers/webauthn';

interface Problem {
  code: string;
  status: number;
}

describe('passkey — WebAuthn (Batch 1.6)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let fixture: TenantFixture;

  /** Cihazda passkey kaydeder: giriş yapmış kullanıcı + challenge + imza. */
  const registerPasskey = async (
    tokens: Tokens,
    device = new SoftwareAuthenticator(),
    deviceLabel = 'iPhone 15',
  ): Promise<{ device: SoftwareAuthenticator; id: string }> => {
    const options = await http(app)
      .post('/api/v1/auth/passkeys/register/options')
      .set(auth(tokens))
      .send({});
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    const challenge = (options.body as { challenge: string }).challenge;

    const registered = await http(app)
      .post('/api/v1/auth/passkeys/register')
      .set(auth(tokens))
      .send({ response: device.register(challenge), deviceLabel });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);

    return { device, id: (registered.body as { id: string }).id };
  };

  const passkeyLogin = async (
    device: SoftwareAuthenticator,
    identifier: Record<string, string> = {},
    counterOverride?: number,
  ) => {
    const options = await http(app).post('/api/v1/auth/passkey/options').send(identifier);
    expect(options.status).toBe(200);
    const challenge = (options.body as { challenge: string }).challenge;

    return http(app)
      .post('/api/v1/auth/passkey/verify')
      .send({ response: device.authenticate(challenge, counterOverride) });
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
    fixture = await bootstrapTenant(app, { slug: 'passkey-klinigi', name: 'Passkey Kliniği' });
  });

  // -------------------------------------------------------------------------
  describe('kayıt', () => {
    it('kayıt yalnız GİRİŞ YAPMIŞ kullanıcı tarafından yapılır', async () => {
      const res = await http(app).post('/api/v1/auth/passkeys/register/options').send({});
      expect(res.status).toBe(401);
    });

    it('kayıt turu tamamlanır ve cihaz listelenir', async () => {
      await registerPasskey(fixture.owner.tokens);

      const list = await http(app).get('/api/v1/auth/passkeys').set(auth(fixture.owner.tokens));
      expect(list.status).toBe(200);
      const data = (list.body as { data: { deviceLabel: string; transports: string[] }[] }).data;
      expect(data).toHaveLength(1);
      expect(data[0]?.deviceLabel).toBe('iPhone 15');
      expect(data[0]?.transports).toContain('internal');
    });

    it('sunucu YALNIZ AÇIK ANAHTARI saklar', async () => {
      await registerPasskey(fixture.owner.tokens);

      const { rows } = await database.ownerPool.query<{
        public_key: Buffer;
        sign_count: string;
        credential_id: string;
      }>('select public_key, sign_count, credential_id from user_passkeys');

      expect(rows).toHaveLength(1);
      // COSE_Key: kty=EC2 (2), alg=-7 → özel anahtar bilgisi YOK.
      expect(rows[0]?.public_key.length).toBeLessThan(120);
      expect(rows[0]?.credential_id).toMatch(/^[\w-]+$/);
    });

    it('challenge TEK KULLANIMLIKTIR', async () => {
      const options = await http(app)
        .post('/api/v1/auth/passkeys/register/options')
        .set(auth(fixture.owner.tokens))
        .send({});
      const challenge = (options.body as { challenge: string }).challenge;
      const device = new SoftwareAuthenticator();

      const first = await http(app)
        .post('/api/v1/auth/passkeys/register')
        .set(auth(fixture.owner.tokens))
        .send({ response: device.register(challenge) });
      expect(first.status).toBe(201);

      const second = await http(app)
        .post('/api/v1/auth/passkeys/register')
        .set(auth(fixture.owner.tokens))
        .send({ response: new SoftwareAuthenticator().register(challenge) });
      expect(second.status).toBe(400);
      expect((second.body as Problem).code).toBe('PASSKEY_INVALID');
    });

    it('süresi dolmuş challenge reddedilir', async () => {
      const options = await http(app)
        .post('/api/v1/auth/passkeys/register/options')
        .set(auth(fixture.owner.tokens))
        .send({});
      const challenge = (options.body as { challenge: string }).challenge;

      await database.ownerPool.query(
        `update webauthn_challenges set expires_at = now() - interval '1 minute'`,
      );

      const res = await http(app)
        .post('/api/v1/auth/passkeys/register')
        .set(auth(fixture.owner.tokens))
        .send({ response: new SoftwareAuthenticator().register(challenge) });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('giriş', () => {
    it('passkey ile giriş TEK ADIMDIR (parola ve TOTP istenmez)', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);

      const res = await passkeyLogin(device, { email: fixture.owner.email });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const body = res.body as { status: string; tokens: Tokens };
      expect(body.status).toBe('authenticated');

      const me = await http(app).get('/api/v1/me').set(auth(body.tokens));
      expect(me.status).toBe(200);
      expect((me.body as { user: { email: string } }).user.email).toBe(fixture.owner.email);
    });

    it('discoverable credential ile tanımlayıcı YAZMADAN giriş yapılır', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);

      // Mobilin asıl kazancı: kullanıcı adı bile yazmaz.
      const res = await passkeyLogin(device);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body as { status: string }).status).toBe('authenticated');
    });

    it('oturum passkey yöntemiyle kaydedilir', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);
      const res = await passkeyLogin(device);
      const tokens = (res.body as { tokens: Tokens }).tokens;

      const sessions = await http(app).get('/api/v1/auth/sessions').set(auth(tokens));
      const current = (
        sessions.body as { data: { current: boolean; authMethod: string }[] }
      ).data.find((session) => session.current);
      expect(current?.authMethod).toBe('passkey');
    });

    it('challenge YENİDEN KULLANILAMAZ', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);

      const options = await http(app).post('/api/v1/auth/passkey/options').send({});
      const challenge = (options.body as { challenge: string }).challenge;

      const first = await http(app)
        .post('/api/v1/auth/passkey/verify')
        .send({ response: device.authenticate(challenge) });
      expect(first.status).toBe(200);

      const replay = await http(app)
        .post('/api/v1/auth/passkey/verify')
        .send({ response: device.authenticate(challenge) });
      expect(replay.status).toBe(401);
      expect((replay.body as Problem).code).toBe('PASSKEY_INVALID');
    });

    it('sayaç GERİLERSE giriş reddedilir (klonlanmış authenticator)', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);
      // Normal giriş sayacı ilerletir.
      expect((await passkeyLogin(device)).status).toBe(200);

      // Klon, eski sayaç değeriyle geliyor.
      const cloned = await passkeyLogin(device, {}, 1);
      expect(cloned.status).toBe(401);
      expect((cloned.body as Problem).code).toBe('PASSKEY_INVALID');
    });

    it('bilinmeyen credential ile giriş yapılamaz', async () => {
      await registerPasskey(fixture.owner.tokens);

      const stranger = new SoftwareAuthenticator();
      const res = await passkeyLogin(stranger);
      expect(res.status).toBe(401);
      expect((res.body as Problem).code).toBe('PASSKEY_INVALID');
    });

    it('başka kullanıcı için üretilmiş challenge ile giriş yapılamaz', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);
      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'baska@passkey.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });
      await registerPasskey(member.tokens, new SoftwareAuthenticator(), 'Android');

      // Challenge ÜYE için üretiliyor, imzayı SAHİBİN cihazı atıyor.
      const options = await http(app)
        .post('/api/v1/auth/passkey/options')
        .send({ email: 'baska@passkey.test' });
      const challenge = (options.body as { challenge: string }).challenge;

      const res = await http(app)
        .post('/api/v1/auth/passkey/verify')
        .send({ response: device.authenticate(challenge) });
      expect(res.status).toBe(401);
    });

    it('bilinmeyen e-posta için de normal seçenek döner (kullanıcı sayımı engellenir)', async () => {
      const res = await http(app)
        .post('/api/v1/auth/passkey/options')
        .send({ email: 'hicyok@passkey.test' });

      expect(res.status).toBe(200);
      const body = res.body as { challenge: string; allowCredentials?: unknown[] };
      expect(body.challenge).toBeTypeOf('string');
      expect(body.allowCredentials ?? []).toHaveLength(0);
    });

    it('imza kurcalanırsa doğrulama başarısız olur', async () => {
      const { device } = await registerPasskey(fixture.owner.tokens);
      const options = await http(app).post('/api/v1/auth/passkey/options').send({});
      const challenge = (options.body as { challenge: string }).challenge;

      const response = device.authenticate(challenge) as {
        response: { signature: string };
      };
      // Tek bir baytı bozmak yeterli.
      const bytes = Buffer.from(response.response.signature, 'base64url');
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      response.response.signature = bytes.toString('base64url');

      const res = await http(app).post('/api/v1/auth/passkey/verify').send({ response });
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('cihaz yönetimi', () => {
    it('cihaz adı değiştirilebilir', async () => {
      const { id } = await registerPasskey(fixture.owner.tokens);

      const res = await http(app)
        .patch(`/api/v1/auth/passkeys/${id}`)
        .set(auth(fixture.owner.tokens))
        .send({ deviceLabel: 'İş telefonu' });

      expect(res.status).toBe(200);
      expect((res.body as { deviceLabel: string }).deviceLabel).toBe('İş telefonu');
    });

    it('başka kullanıcının passkey’i görünmez ve silinemez', async () => {
      const { id } = await registerPasskey(fixture.owner.tokens);
      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'yabanci@passkey.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      const list = await http(app).get('/api/v1/auth/passkeys').set(auth(member.tokens));
      expect((list.body as { data: unknown[] }).data).toHaveLength(0);

      const res = await http(app).delete(`/api/v1/auth/passkeys/${id}`).set(auth(member.tokens));
      expect(res.status).toBe(404);
    });

    it('parolası olan kullanıcı son passkey’ini silebilir', async () => {
      const { id, device } = await registerPasskey(fixture.owner.tokens);

      const res = await http(app)
        .delete(`/api/v1/auth/passkeys/${id}`)
        .set(auth(fixture.owner.tokens));
      expect(res.status).toBe(204);

      // Silinen cihazla giriş yapılamaz.
      expect((await passkeyLogin(device)).status).toBe(401);
    });

    it('parolası OLMAYAN kullanıcının son passkey’i silinemez (kilitlenme koruması)', async () => {
      const { id } = await registerPasskey(fixture.owner.tokens);
      // Parolası hiç kurulmamış bir hesabı taklit ediyoruz: mobilde yalnız
      // passkey ile giren kullanıcı bu durumda olabilir.
      await database.ownerPool.query('update users set password_hash = null where id = $1', [
        fixture.owner.userId,
      ]);

      const res = await http(app)
        .delete(`/api/v1/auth/passkeys/${id}`)
        .set(auth(fixture.owner.tokens));

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CREDENTIAL_REQUIRED');
    });

    it('birden çok cihaz kaydedilebilir ve her biri giriş yapabilir', async () => {
      const first = await registerPasskey(
        fixture.owner.tokens,
        new SoftwareAuthenticator(),
        'Telefon',
      );
      const second = await registerPasskey(
        fixture.owner.tokens,
        new SoftwareAuthenticator(),
        'Tablet',
      );

      const list = await http(app).get('/api/v1/auth/passkeys').set(auth(fixture.owner.tokens));
      expect((list.body as { data: unknown[] }).data).toHaveLength(2);

      expect((await passkeyLogin(first.device)).status).toBe(200);
      expect((await passkeyLogin(second.device)).status).toBe(200);
    });
  });
});
