import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from '@klinara/shared';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  DEFAULT_PASSWORD,
  http,
  invite,
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

describe('kullanıcılar, roller ve davetler (Batch 1.1 & 1.3)', () => {
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
    fixture = await bootstrapTenant(app, { slug: 'kimlik-klinigi', name: 'Kimlik Kliniği' });
  });

  // -------------------------------------------------------------------------
  describe('referans veri', () => {
    it('veritabanındaki roller ve izinler paylaşılan tanımla BİREBİR aynıdır', async () => {
      // Bu test drift'i yakalar: SQL seed'i ile `packages/shared` ayrıştığı anda
      // yetki kontrolleri sessizce yanlış çalışmaya başlardı.
      const permissions = await database.ownerPool.query<{ key: string }>(
        'select key from permissions order by key',
      );
      expect(permissions.rows.map((row) => row.key)).toEqual([...ALL_PERMISSIONS].sort());

      const roles = await database.ownerPool.query<{ key: string; rank: number; scope: string }>(
        'select key, rank, scope from roles order by key',
      );
      expect(roles.rows).toEqual(
        [...ROLE_DEFINITIONS]
          .map((role) => ({ key: role.key, rank: role.rank, scope: role.scope }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      );

      const rolePermissions = await database.ownerPool.query<{
        role_key: string;
        permission_key: string;
      }>('select role_key, permission_key from role_permissions order by role_key, permission_key');

      const expected = ROLE_DEFINITIONS.flatMap((role) =>
        role.permissions.map((permission) => `${role.key}:${permission}`),
      ).sort();
      expect(
        rolePermissions.rows.map((row) => `${row.role_key}:${row.permission_key}`).sort(),
      ).toEqual(expected);
    });

    it('uygulama rolü referans veriyi DEĞİŞTİREMEZ', async () => {
      // `klinara_app` kendi yetkisini genişletemez: rol-izin tablosu salt okunur.
      await expect(
        database.appPool.query(
          `insert into role_permissions (role_key, permission_key)
           values ('receptionist', 'report.revenue:read')`,
        ),
      ).rejects.toThrow(/permission|izin|denied/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('/me', () => {
    it('kullanıcıyı, rollerini ve izinlerini döner', async () => {
      const res = await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens));

      expect(res.status).toBe(200);
      const body = res.body as {
        user: { email: string; hasPassword: boolean; phoneVerified: boolean };
        roles: string[];
        permissions: string[];
        tenantWide: boolean;
      };
      expect(body.user.email).toBe(fixture.owner.email);
      expect(body.user.hasPassword).toBe(true);
      expect(body.user.phoneVerified).toBe(false);
      expect(body.roles).toEqual(['owner']);
      expect(body.tenantWide).toBe(true);
      expect(body.permissions).toContain('appointment:write');
    });

    it('şube kapsamlı rolde yalnız o şube görünür', async () => {
      const second = await http(app)
        .post('/api/v1/branches')
        .set(auth(fixture.owner.tokens))
        .send({ slug: 'kadikoy', name: 'Kadıköy' });
      const secondBranchId = (second.body as { id: string }).id;

      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'resepsiyon@klinik.test',
        roleKey: 'receptionist',
        branchId: secondBranchId,
      });

      const me = await http(app).get('/api/v1/me').set(auth(member.tokens));
      const body = me.body as { branchIds: string[]; tenantWide: boolean };
      expect(body.tenantWide).toBe(false);
      expect(body.branchIds).toEqual([secondBranchId]);
    });

    it('kendi profilini güncelleyebilir', async () => {
      const res = await http(app)
        .patch('/api/v1/me')
        .set(auth(fixture.owner.tokens))
        .send({ fullName: 'Yeni Ad Soyad' });
      expect(res.status).toBe(200);
      expect((res.body as { fullName: string }).fullName).toBe('Yeni Ad Soyad');
    });
  });

  // -------------------------------------------------------------------------
  describe('izin matrisi', () => {
    interface Case {
      role: string;
      branchScoped: boolean;
      expected: Record<string, number>;
    }

    const CASES: Case[] = [
      {
        role: 'manager',
        branchScoped: true,
        expected: { users: 200, invitations: 201, tenantPatch: 403, branchPost: 403 },
      },
      {
        role: 'receptionist',
        branchScoped: true,
        expected: { users: 403, invitations: 403, tenantPatch: 403, branchPost: 403 },
      },
      {
        role: 'practitioner',
        branchScoped: true,
        expected: { users: 403, invitations: 403, tenantPatch: 403, branchPost: 403 },
      },
      {
        role: 'accountant',
        branchScoped: false,
        expected: { users: 403, invitations: 403, tenantPatch: 403, branchPost: 403 },
      },
    ];

    for (const testCase of CASES) {
      it(`${testCase.role} rolü beklenen yetkilere sahiptir`, async () => {
        const member = await inviteMember(app, fixture.owner.tokens, {
          email: `${testCase.role}@klinik.test`,
          roleKey: testCase.role,
          ...(testCase.branchScoped ? { branchId: fixture.branch.id } : {}),
        });

        const users = await http(app).get('/api/v1/users').set(auth(member.tokens));
        expect(users.status, 'GET /users').toBe(testCase.expected['users']);

        const invitation = await http(app)
          .post('/api/v1/invitations')
          .set(auth(member.tokens))
          .send({
            email: `davet-${testCase.role}@klinik.test`,
            roleKey: 'practitioner',
            branchId: fixture.branch.id,
          });
        expect(invitation.status, 'POST /invitations').toBe(testCase.expected['invitations']);

        const tenantPatch = await http(app)
          .patch('/api/v1/tenant')
          .set(auth(member.tokens))
          .send({ name: 'Yeni' });
        expect(tenantPatch.status, 'PATCH /tenant').toBe(testCase.expected['tenantPatch']);

        const branchPost = await http(app)
          .post('/api/v1/branches')
          .set(auth(member.tokens))
          .send({ slug: 'yeni-sube', name: 'Yeni Şube' });
        expect(branchPost.status, 'POST /branches').toBe(testCase.expected['branchPost']);
      });
    }

    it('sahip (owner) her şeyi yapabilir', async () => {
      expect((await http(app).get('/api/v1/users').set(auth(fixture.owner.tokens))).status).toBe(
        200,
      );
      expect(
        (
          await http(app)
            .patch('/api/v1/tenant')
            .set(auth(fixture.owner.tokens))
            .send({ name: 'Sahip Değiştirdi' })
        ).status,
      ).toBe(200);
    });

    it('403 gövde doğrulamasından ÖNCE döner (şema sızmaz)', async () => {
      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'sema@klinik.test',
        roleKey: 'receptionist',
        branchId: fixture.branch.id,
      });

      const res = await http(app)
        .post('/api/v1/invitations')
        .set(auth(member.tokens))
        .send({ tamamen: 'gecersiz' });

      expect(res.status).toBe(403);
      expect(res.text).not.toContain('roleKey');
    });
  });

  // -------------------------------------------------------------------------
  describe('şube kapsamı', () => {
    it('üyesi olmadığı şubeyi X-Branch-Id ile seçemez', async () => {
      const second = await http(app)
        .post('/api/v1/branches')
        .set(auth(fixture.owner.tokens))
        .send({ slug: 'besiktas', name: 'Beşiktaş' });
      const otherBranchId = (second.body as { id: string }).id;

      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'sube-disi@klinik.test',
        roleKey: 'receptionist',
        branchId: fixture.branch.id,
      });

      const res = await http(app)
        .get('/api/v1/me')
        .set(auth(member.tokens))
        .set('x-branch-id', otherBranchId);

      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('BRANCH_FORBIDDEN');
    });

    it('kiracı kapsamlı rol tüm şubeleri kapsar', async () => {
      const second = await http(app)
        .post('/api/v1/branches')
        .set(auth(fixture.owner.tokens))
        .send({ slug: 'uskudar', name: 'Üsküdar' });
      const otherBranchId = (second.body as { id: string }).id;

      const res = await http(app)
        .get('/api/v1/me')
        .set(auth(fixture.owner.tokens))
        .set('x-branch-id', otherBranchId);
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('davet akışı', () => {
    it('davet önizlemesi kimlik doğrulaması olmadan okunur ve az bilgi verir', async () => {
      const created = await http(app)
        .post('/api/v1/invitations')
        .set(auth(fixture.owner.tokens))
        .send({
          email: 'onizleme@klinik.test',
          roleKey: 'practitioner',
          branchId: fixture.branch.id,
        });
      expect(created.status).toBe(201);

      const token = (created.body as { token: string }).token;
      const preview = await http(app).get(`/api/v1/invitations/token/${token}`);

      expect(preview.status).toBe(200);
      const body = preview.body as Record<string, unknown>;
      expect(body['email']).toBe('onizleme@klinik.test');
      expect(body['tenantName']).toBe('Kimlik Kliniği');
      expect(body['roleName']).toBe('Uygulayıcı');
      expect(body['accountExists']).toBe(false);
      // Kiracının başka hiçbir verisi sızmamalı.
      expect(Object.keys(body)).not.toContain('tokenHash');
      expect(Object.keys(body)).not.toContain('tenantId');
    });

    it('davet TEK KULLANIMLIKTIR', async () => {
      const created = await http(app)
        .post('/api/v1/invitations')
        .set(auth(fixture.owner.tokens))
        .send({ email: 'tek@klinik.test', roleKey: 'manager', branchId: fixture.branch.id });
      const token = (created.body as { token: string }).token;

      const first = await http(app)
        .post(`/api/v1/invitations/token/${token}/accept`)
        .send({ password: DEFAULT_PASSWORD, fullName: 'Tek Kullanım' });
      expect(first.status).toBe(200);

      const second = await http(app)
        .post(`/api/v1/invitations/token/${token}/accept`)
        .send({ password: DEFAULT_PASSWORD });
      expect(second.status).toBe(400);
      expect((second.body as Problem).code).toBe('INVITATION_INVALID');
    });

    it('geçersiz token da aynı hatayı verir (varlık sızmaz)', async () => {
      const res = await http(app).get('/api/v1/invitations/token/uydurma-token');
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('INVITATION_INVALID');
    });

    it('iptal edilen davet kabul edilemez', async () => {
      const created = await http(app)
        .post('/api/v1/invitations')
        .set(auth(fixture.owner.tokens))
        .send({ email: 'iptal@klinik.test', roleKey: 'manager', branchId: fixture.branch.id });
      const { id, token } = created.body as { id: string; token: string };

      const revoked = await http(app)
        .delete(`/api/v1/invitations/${id}`)
        .set(auth(fixture.owner.tokens));
      expect(revoked.status).toBe(204);

      const accept = await http(app)
        .post(`/api/v1/invitations/token/${token}/accept`)
        .send({ password: DEFAULT_PASSWORD });
      expect(accept.status).toBe(400);
    });

    it('kimse KENDİNDEN geniş yetkili bir rolü davet edemez', async () => {
      const manager = await inviteMember(app, fixture.owner.tokens, {
        email: 'mudur@klinik.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      const escalation = await http(app)
        .post('/api/v1/invitations')
        .set(auth(manager.tokens))
        .send({ email: 'sahte-sahip@klinik.test', roleKey: 'owner' });

      expect(escalation.status).toBe(403);
      expect((escalation.body as Problem).code).toBe('ROLE_ESCALATION');
    });

    it('şube kapsamlı rol şubesiz davet edilemez', async () => {
      const res = await http(app)
        .post('/api/v1/invitations')
        .set(auth(fixture.owner.tokens))
        .send({ email: 'subesiz@klinik.test', roleKey: 'receptionist' });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('kiracı kapsamlı rol şubeye bağlanamaz', async () => {
      const res = await http(app).post('/api/v1/invitations').set(auth(fixture.owner.tokens)).send({
        email: 'muhasebe@klinik.test',
        roleKey: 'accountant',
        branchId: fixture.branch.id,
      });
      expect(res.status).toBe(400);
    });

    it('başka kiracının şubesine davet edilemez', async () => {
      const other = await bootstrapTenant(app, { slug: 'komsu-klinik', name: 'Komşu' });

      const res = await http(app).post('/api/v1/invitations').set(auth(fixture.owner.tokens)).send({
        email: 'capraz@klinik.test',
        roleKey: 'receptionist',
        branchId: other.branch.id,
      });

      // RLS ve trigger birlikte: şube ya görünmez ya da kiracı uyuşmaz.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('aynı e-postaya ikinci bekleyen davet açılamaz', async () => {
      await http(app)
        .post('/api/v1/invitations')
        .set(auth(fixture.owner.tokens))
        .send({ email: 'mukerrer@klinik.test', roleKey: 'manager', branchId: fixture.branch.id });

      const second = await http(app)
        .post('/api/v1/invitations')
        .set(auth(fixture.owner.tokens))
        .send({ email: 'mukerrer@klinik.test', roleKey: 'manager', branchId: fixture.branch.id });

      expect(second.status).toBe(409);
    });

    it('MEVCUT hesabı davet etmek parolasını DEĞİŞTİRMEZ (hesap devralma koruması)', async () => {
      const other = await bootstrapTenant(app, { slug: 'devralma', name: 'Devralma' });

      const accepted = await invite(app, other.owner.tokens, {
        email: fixture.owner.email,
        roleKey: 'receptionist',
        branchId: other.branch.id,
        // Saldırganın belirlemeye çalıştığı parola.
        password: 'saldirganin-parolasi-123',
      });
      expect(accepted.status).toBe('membership_added');
      expect(accepted.tokens).toBeUndefined();

      // Eski parola hâlâ geçerli, yenisi değil.
      expect((await login(app, { email: fixture.owner.email })).status).toBe(200);
      const withNew = await login(app, {
        email: fixture.owner.email,
        password: 'saldirganin-parolasi-123',
      });
      expect(withNew.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('kullanıcı listesi ve kiracı izolasyonu', () => {
    it('yalnız kendi kliniğinin personelini gösterir', async () => {
      await inviteMember(app, fixture.owner.tokens, {
        email: 'personel@klinik.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });
      const other = await bootstrapTenant(app, { slug: 'ayri-klinik', name: 'Ayrı' });
      await inviteMember(app, other.owner.tokens, {
        email: 'digerpersonel@klinik.test',
        roleKey: 'manager',
        branchId: other.branch.id,
      });

      const res = await http(app).get('/api/v1/users').set(auth(fixture.owner.tokens));
      const emails = (res.body as { data: { email: string }[] }).data.map((u) => u.email);

      expect(emails).toContain('personel@klinik.test');
      expect(emails).not.toContain('digerpersonel@klinik.test');
      expect(emails).toHaveLength(2);
    });

    it('başka kiracının kullanıcısı "bulunamadı" döner', async () => {
      const other = await bootstrapTenant(app, { slug: 'gizli-klinik', name: 'Gizli' });
      const res = await http(app)
        .get(`/api/v1/users/${other.owner.userId}`)
        .set(auth(fixture.owner.tokens));
      expect(res.status).toBe(404);
    });

    it('yetki değişimi SONRAKİ istekte etkilidir (cache invalidasyonu)', async () => {
      const member = await inviteMember(app, fixture.owner.tokens, {
        email: 'cache@klinik.test',
        roleKey: 'manager',
        branchId: fixture.branch.id,
      });

      expect((await http(app).get('/api/v1/users').set(auth(member.tokens))).status).toBe(200);

      // Hesap devre dışı bırakılıyor: cache düşürülmezse eski yetki 15 saniye
      // daha yaşardı.
      await http(app)
        .patch(`/api/v1/users/${member.userId}`)
        .set(auth(fixture.owner.tokens))
        .send({ isActive: false });

      const after = await http(app).get('/api/v1/users').set(auth(member.tokens));
      expect(after.status).toBe(403);
      expect((after.body as Problem).code).toBe('ACCOUNT_DISABLED');
    });
  });

  // -------------------------------------------------------------------------
  describe('parola akışları', () => {
    it('sıfırlama isteği var olmayan e-posta için de AYNI yanıtı verir', async () => {
      const known = await http(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email: fixture.owner.email });
      const unknown = await http(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'hicyok@yok.test' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect((known.body as { status: string }).status).toBe('accepted');
      expect((unknown.body as { status: string }).status).toBe('accepted');
      // Var olmayan e-posta için token üretilmez ama yanıt ayırt edilemez.
      expect((unknown.body as { token?: string }).token).toBeUndefined();
    });

    it('sıfırlama token’ı tek kullanımlıktır ve tüm oturumları düşürür', async () => {
      const forgot = await http(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email: fixture.owner.email });
      const token = (forgot.body as { token: string }).token;

      const reset = await http(app)
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'yepyeni-parola-456' });
      expect(reset.status).toBe(204);

      // Eski oturum düştü.
      expect((await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens))).status).toBe(401);
      // Yeni parola çalışıyor, eskisi çalışmıyor.
      expect(
        (await login(app, { email: fixture.owner.email, password: 'yepyeni-parola-456' })).status,
      ).toBe(200);
      expect((await login(app, { email: fixture.owner.email })).status).toBe(401);

      // Token ikinci kez kullanılamaz.
      const again = await http(app)
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'baska-parola-789' });
      expect(again.status).toBe(400);
    });

    it('parola değiştirme mevcut parolayı sorar ve yeni oturum verir', async () => {
      const wrong = await http(app)
        .post('/api/v1/auth/password/change')
        .set(auth(fixture.owner.tokens))
        .send({ currentPassword: 'yanlis-parola', newPassword: 'degisen-parola-111' });
      expect(wrong.status).toBe(400);
      expect((wrong.body as Problem).code).toBe('INVALID_CREDENTIALS');

      const changed = await http(app)
        .post('/api/v1/auth/password/change')
        .set(auth(fixture.owner.tokens))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'degisen-parola-111' });
      expect(changed.status).toBe(200);

      const fresh = changed.body as Tokens;
      expect((await http(app).get('/api/v1/me').set(auth(fresh))).status).toBe(200);
      // Eski token artık geçersiz (token sürümü arttı).
      expect((await http(app).get('/api/v1/me').set(auth(fixture.owner.tokens))).status).toBe(401);
    });

    it('kısa parola reddedilir', async () => {
      const res = await http(app)
        .post('/api/v1/auth/password/change')
        .set(auth(fixture.owner.tokens))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'kisa' });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });
  });
});
