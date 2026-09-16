import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

interface MembershipBody {
  id: string;
  branchId: string | null;
  roleKey: string;
  roleName: string;
}

interface Problem {
  code: string;
}

interface MeBody {
  roles: string[];
  permissions: string[];
  tenantWide: boolean;
}

describe('rol değiştirme — PUT /users/:id/memberships (Faz 1 devreden madde)', () => {
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

  const putMemberships = (
    userId: string,
    memberships: Record<string, unknown>[],
    as = ownerAuth(),
  ) => http(app).put(`/api/v1/users/${userId}/memberships`).set(as).send({ memberships });

  const rolesOf = async (tokens: Tokens): Promise<MeBody> =>
    (await http(app).get('/api/v1/me').set(auth(tokens)).expect(200)).body as MeBody;

  // -------------------------------------------------------------------------
  it('rolü değiştirir ve değişim ANINDA etkili olur', async () => {
    expect((await rolesOf(receptionist.tokens)).roles).toEqual(['receptionist']);

    const res = await putMemberships(receptionist.userId, [
      { roleKey: 'manager', branchId: clinic.branch.id },
    ]).expect(200);

    const rows = (res.body as { data: MembershipBody[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roleKey).toBe('manager');
    expect(rows[0]?.roleName).toBe('Şube Yöneticisi');

    // İzinler access token'da TAŞINMIYOR: eski token yeni rolle çözümleniyor.
    // Faz 1'in "rol değişimi çeyrek saat gecikmemeli" gerekçesi tam olarak bu.
    const after = await rolesOf(receptionist.tokens);
    expect(after.roles).toEqual(['manager']);
    expect(after.permissions).toContain('schedule:write');
  });

  it('TAM DEĞİŞTİRME: listede olmayan üyelik pasife alınır', async () => {
    const second = await http(app)
      .post('/api/v1/branches')
      .set(ownerAuth())
      .send({ slug: 'ikinci', name: 'İkinci Şube', timezone: 'Europe/Istanbul' })
      .expect(201);
    const secondBranchId = (second.body as { id: string }).id;

    await putMemberships(receptionist.userId, [
      { roleKey: 'receptionist', branchId: clinic.branch.id },
      { roleKey: 'receptionist', branchId: secondBranchId },
    ]).expect(200);
    expect((await rolesOf(receptionist.tokens)).permissions.length).toBeGreaterThan(0);

    const trimmed = await putMemberships(receptionist.userId, [
      { roleKey: 'receptionist', branchId: secondBranchId },
    ]).expect(200);
    const rows = (trimmed.body as { data: MembershipBody[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.branchId).toBe(secondBranchId);
  });

  it('boş liste kullanıcıyı klinikten ÇIKARIR', async () => {
    await putMemberships(receptionist.userId, []).expect(200);

    // Üyeliği kalmayan kullanıcı listede de detayda da görünmez.
    const detail = await http(app)
      .get(`/api/v1/users/${receptionist.userId}`)
      .set(ownerAuth());
    expect(detail.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  describe('yetki yükseltme koruması', () => {
    let manager: { userId: string; tokens: Tokens };

    beforeEach(async () => {
      manager = await inviteMember(app, clinic.owner.tokens, {
        email: 'mudur@demo-klinik.test',
        roleKey: 'manager',
        branchId: clinic.branch.id,
      });
    });

    it('şube yöneticisi KENDİNDEN geniş bir rol ATAYAMAZ', async () => {
      const res = await putMemberships(
        receptionist.userId,
        [{ roleKey: 'owner' }],
        auth(manager.tokens),
      );
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('ROLE_ESCALATION');
    });

    it('şube yöneticisi işletme sahibinin üyeliğini KALDIRAMAZ', async () => {
      // Yalnız VERİLEN rolü denetlemek yetmezdi: yetki yükseltmenin aynı
      // sonuca varan tersi, kendinden yetkili tek kişiyi klinikten atmaktır.
      const res = await putMemberships(clinic.owner.userId, [], auth(manager.tokens));
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('ROLE_ESCALATION');
    });

    it('kimse KENDİ rollerine dokunamaz', async () => {
      const res = await putMemberships(
        manager.userId,
        [{ roleKey: 'receptionist', branchId: clinic.branch.id }],
        auth(manager.tokens),
      );
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('FORBIDDEN');
    });

    it('resepsiyonun rol değiştirme yetkisi HİÇ YOK', async () => {
      const res = await putMemberships(
        manager.userId,
        [{ roleKey: 'receptionist', branchId: clinic.branch.id }],
        auth(receptionist.tokens),
      );
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('bütünlük kuralları', () => {
    it('işletme sahibi KENDİ rolünü düşüremez', async () => {
      // Kiracıyı sahipsiz bırakmanın en kısa yolu buydu. Sunucuda ayrıca bir
      // "son sahip" kontrolü var ama bugünkü rol kümesiyle o dala hiç
      // ulaşılmıyor: son sahibi kaldırabilecek aktör zaten ikinci bir sahip
      // olmak zorunda (bkz. `assertOwnerSurvives` yorumu).
      const res = await putMemberships(clinic.owner.userId, [
        { roleKey: 'receptionist', branchId: clinic.branch.id },
      ]);
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('FORBIDDEN');
    });

    it('ikinci bir sahip varken ilki düşürülebilir', async () => {
      const secondOwner = await inviteMember(app, clinic.owner.tokens, {
        email: 'ortak@demo-klinik.test',
        roleKey: 'owner',
      });

      await putMemberships(secondOwner.userId, [
        { roleKey: 'manager', branchId: clinic.branch.id },
      ]).expect(200);
      expect((await rolesOf(secondOwner.tokens)).roles).toEqual(['manager']);
    });

    it('şube kapsamlı rol şubesiz, kiracı kapsamlı rol şubeli GÖNDERİLEMEZ', async () => {
      const missingBranch = await putMemberships(receptionist.userId, [
        { roleKey: 'receptionist' },
      ]);
      expect(missingBranch.status).toBe(400);

      const extraBranch = await putMemberships(receptionist.userId, [
        { roleKey: 'owner', branchId: clinic.branch.id },
      ]);
      expect(extraBranch.status).toBe(400);
    });

    it('platform rolü ATANAMAZ', async () => {
      const res = await putMemberships(receptionist.userId, [{ roleKey: 'platform_admin' }]);
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('aynı rol ve şube iki kez gönderilemez', async () => {
      const res = await putMemberships(receptionist.userId, [
        { roleKey: 'receptionist', branchId: clinic.branch.id },
        { roleKey: 'receptionist', branchId: clinic.branch.id },
      ]);
      expect(res.status).toBe(400);
    });

    it('BAŞKA kiracının şubesi 403, BAŞKA kiracının kullanıcısı 404 alır', async () => {
      const other = await setupClinic(app, { slug: 'rakip-klinik' });

      const foreignBranch = await putMemberships(receptionist.userId, [
        { roleKey: 'receptionist', branchId: other.branch.id },
      ]);
      expect(foreignBranch.status).toBe(403);
      expect((foreignBranch.body as Problem).code).toBe('BRANCH_FORBIDDEN');

      // Varlığı sızmıyor: "başka kiracının kullanıcısı" da bulunamadıdır.
      const foreignUser = await putMemberships(other.owner.userId, [
        { roleKey: 'receptionist', branchId: clinic.branch.id },
      ]);
      expect(foreignUser.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  it('GET /users/:id/memberships mevcut rolleri döner', async () => {
    const res = await http(app)
      .get(`/api/v1/users/${receptionist.userId}/memberships`)
      .set(ownerAuth())
      .expect(200);

    const rows = (res.body as { data: MembershipBody[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      roleKey: 'receptionist',
      roleName: 'Resepsiyon',
      branchId: clinic.branch.id,
    });
  });
});
