import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import {
  auth,
  bootstrapTenant,
  DEFAULT_PASSWORD,
  http,
  PLATFORM_TOKEN,
  type TenantFixture,
} from '../helpers/identity';
import { setupClinic } from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
}

interface StaffBody {
  userId: string;
  userEmail: string;
  title: string | null;
  primaryBranchId: string | null;
  isVisibleOnline: boolean;
  isActive: boolean;
  services: { serviceId: string }[];
}

interface UserBody {
  email: string;
  memberships: { roleKey: string; branchId: string | null }[];
}

/**
 * Uygulayıcı davetiyle birlikte personel profili: kabulde üyelikle aynı
 * transaction'da açılır, kabul profil yüzünden asla başarısız olmaz.
 */
describe('davetle personel profili', () => {
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

  const sendInvitation = (
    clinic: TenantFixture,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> =>
    http(app)
      .post('/api/v1/invitations')
      .set(auth(clinic.owner.tokens))
      .send({ roleKey: 'practitioner', branchId: clinic.branch.id, ...body });

  const accept = (token: string) =>
    http(app)
      .post(`/api/v1/invitations/token/${token}/accept`)
      .send({ password: DEFAULT_PASSWORD, fullName: 'Yeni Hekim' });

  const listStaff = async (clinic: TenantFixture): Promise<StaffBody[]> => {
    const res = await http(app).get('/api/v1/staff').set(auth(clinic.owner.tokens));
    expect(res.status).toBe(200);
    return (res.body as { data: StaffBody[] }).data;
  };

  it('kabulde profil unvan, görünürlük ve hizmetlerle açılır', async () => {
    const clinic = await setupClinic(app);

    const created = await sendInvitation(clinic, {
      email: 'yeni.hekim@klinik.test',
      staffProfile: {
        title: '  Dermatolog ',
        isVisibleOnline: false,
        serviceIds: [clinic.service.id, clinic.quickService.id],
      },
    });
    expect(created.status).toBe(201);

    const token = (created.body as { token: string }).token;
    expect((await accept(token)).status).toBe(200);

    const profile = (await listStaff(clinic)).find((p) => p.userEmail === 'yeni.hekim@klinik.test');
    expect(profile).toBeDefined();
    expect(profile?.title).toBe('Dermatolog');
    expect(profile?.isVisibleOnline).toBe(false);
    expect(profile?.isActive).toBe(true);
    expect(profile?.primaryBranchId).toBe(clinic.branch.id);
    expect(profile?.services.map((s) => s.serviceId).sort()).toEqual(
      [clinic.service.id, clinic.quickService.id].sort(),
    );
  });

  it('profil taslağı olmayan davet eskisi gibi yalnız üyelik açar', async () => {
    const clinic = await setupClinic(app);
    const created = await sendInvitation(clinic, { email: 'profilsiz@klinik.test' });
    expect(created.status).toBe(201);
    expect((await accept((created.body as { token: string }).token)).status).toBe(200);

    expect((await listStaff(clinic)).some((p) => p.userEmail === 'profilsiz@klinik.test')).toBe(
      false,
    );
  });

  it('uygulayıcı dışındaki rol profil taslağı taşıyamaz', async () => {
    const clinic = await setupClinic(app);
    const res = await sendInvitation(clinic, {
      email: 'yonetici@klinik.test',
      roleKey: 'manager',
      staffProfile: { serviceIds: [] },
    });
    expect(res.status).toBe(400);
  });

  it('pasif ya da yabancı hizmet kimliği davet anında reddedilir', async () => {
    const clinic = await setupClinic(app);
    const res = await sendInvitation(clinic, {
      email: 'hayalet@klinik.test',
      staffProfile: { serviceIds: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(res.status).toBe(400);
  });

  it('davetten sonra pasife alınan hizmet yetkinlikten düşer, kabul bozulmaz', async () => {
    const clinic = await setupClinic(app);
    const created = await sendInvitation(clinic, {
      email: 'gec@klinik.test',
      staffProfile: { serviceIds: [clinic.service.id, clinic.quickService.id] },
    });
    expect(created.status).toBe(201);

    const off = await http(app)
      .patch(`/api/v1/services/${clinic.quickService.id}`)
      .set(auth(clinic.owner.tokens))
      .send({ isActive: false });
    expect(off.status).toBe(200);

    expect((await accept((created.body as { token: string }).token)).status).toBe(200);
    const profile = (await listStaff(clinic)).find((p) => p.userEmail === 'gec@klinik.test');
    expect(profile?.services.map((s) => s.serviceId)).toEqual([clinic.service.id]);
  });

  it('hekim kotası doluysa davet baştan 409 PLAN_PRACTITIONER_LIMIT_REACHED döner', async () => {
    const clinic = await bootstrapTenant(app, {
      slug: 'kota-dolu',
      plan: { planKey: 'baslangic', maxPractitionersOverride: 1 },
    });
    const first = await sendInvitation(clinic, {
      email: 'dolduran@klinik.test',
      staffProfile: { serviceIds: [] },
    });
    expect(first.status).toBe(201);
    expect((await accept((first.body as { token: string }).token)).status).toBe(200);

    const res = await sendInvitation(clinic, {
      email: 'kota@klinik.test',
      staffProfile: { serviceIds: [] },
    });
    expect(res.status).toBe(409);
    expect((res.body as Problem).code).toBe('PLAN_PRACTITIONER_LIMIT_REACHED');
  });

  it('davet ile kabul arasında kota dolarsa profil PASİF açılır, kabul başarılı olur', async () => {
    const clinic = await bootstrapTenant(app, {
      slug: 'kota-yaris',
      plan: { planKey: 'baslangic', maxPractitionersOverride: 1 },
    });
    const first = await sendInvitation(clinic, {
      email: 'ilk@klinik.test',
      staffProfile: { serviceIds: [] },
    });
    const second = await sendInvitation(clinic, {
      email: 'ikinci@klinik.test',
      staffProfile: { serviceIds: [] },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    expect((await accept((first.body as { token: string }).token)).status).toBe(200);
    expect((await accept((second.body as { token: string }).token)).status).toBe(200);

    const staff = await listStaff(clinic);
    expect(staff.find((p) => p.userEmail === 'ilk@klinik.test')?.isActive).toBe(true);
    expect(staff.find((p) => p.userEmail === 'ikinci@klinik.test')?.isActive).toBe(false);
  });

  it('GET /users üyelikleri (rol/şube) ile birlikte döner', async () => {
    const clinic = await setupClinic(app);
    const res = await http(app).get('/api/v1/users').set(auth(clinic.owner.tokens));
    expect(res.status).toBe(200);

    const users = (res.body as { data: UserBody[] }).data;
    expect(users.length).toBeGreaterThan(1);
    expect(users.every((user) => user.memberships.length > 0)).toBe(true);
    const practitioner = users.find((user) =>
      user.memberships.some((m) => m.roleKey === 'practitioner'),
    );
    expect(practitioner?.memberships[0]?.branchId).toBe(clinic.branch.id);
  });
});
