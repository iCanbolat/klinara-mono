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

interface StaffBody {
  id: string;
  userId: string;
  userFullName: string;
  title: string | null;
  specialties: string[];
  isActive: boolean;
  services: {
    serviceId: string;
    branchId: string | null;
    customDurationMinutes: number | null;
    customPriceMinor: number | null;
  }[];
}

describe('personel profili ve yetkinlik', () => {
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
  it('profili kullanıcı bilgisiyle birlikte döner', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .get(`/api/v1/staff/${clinic.practitioner.staffProfileId}`)
      .set(auth(clinic.owner.tokens));

    expect(res.status).toBe(200);
    const body = res.body as StaffBody;
    expect(body.userId).toBe(clinic.practitioner.userId);
    expect(body.userFullName).toBe('Demo Uygulayıcı');
    expect(body.title).toBe('Lazer Uzmanı');
    expect(body.services).toHaveLength(2);
  });

  it('aynı kullanıcı için ikinci profil açılamaz', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .post('/api/v1/staff')
      .set(auth(clinic.owner.tokens))
      .send({ userId: clinic.practitioner.userId });

    expect(res.status).toBe(409);
    expect((res.body as Problem).code).toBe('CONFLICT');
  });

  it('yetkinlik matrisi toplu PUT ile TAMAMEN değiştirilir', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    const res = await http(app)
      .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
      .set(ownerAuth)
      .send({
        services: [
          {
            serviceId: clinic.quickService.id,
            branchId: clinic.branch.id,
            customDurationMinutes: 45,
            customPriceMinor: 60000,
          },
        ],
      });

    expect(res.status).toBe(200);
    const services = (res.body as StaffBody).services;
    expect(services).toHaveLength(1);
    expect(services[0]?.serviceId).toBe(clinic.quickService.id);
    expect(services[0]?.customDurationMinutes).toBe(45);
    expect(services[0]?.customPriceMinor).toBe(60000);
  });

  it('aynı hizmet/şube eşleşmesi iki kez gönderilemez', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
      .set(auth(clinic.owner.tokens))
      .send({
        services: [
          { serviceId: clinic.service.id, branchId: clinic.branch.id },
          { serviceId: clinic.service.id, branchId: clinic.branch.id },
        ],
      });

    expect(res.status).toBe(400);
    expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
  });

  it('PASİF hizmete yetkinlik atanamaz', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    const deactivated = await http(app)
      .delete(`/api/v1/services/${clinic.quickService.id}`)
      .set(ownerAuth);
    expect(deactivated.status).toBe(200);

    const res = await http(app)
      .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
      .set(ownerAuth)
      .send({ services: [{ serviceId: clinic.quickService.id, branchId: clinic.branch.id }] });

    expect(res.status).toBe(409);
    expect((res.body as Problem).code).toBe('CONFLICT');
  });

  it('kiracının üyesi OLMAYAN kullanıcıya profil açılamaz', async () => {
    // Kullanıcılar kiracı-üstüdür ve FK doğrulaması RLS'i bypass eder: başka
    // bir kiracının kullanıcı kimliği foreign key'den SORUNSUZ geçer. Kuralı
    // tutan tek şey `staff_profiles_validate_scope()` trigger'ıdır — ve bu
    // hata istemciye anlamlı bir 4xx olarak dönmelidir, 500 olarak değil.
    const clinic = await setupClinic(app, { slug: 'klinik-a' });
    const other = await bootstrapTenant(app, { slug: 'klinik-b' });

    const res = await http(app)
      .post('/api/v1/staff')
      .set(auth(other.owner.tokens))
      .send({ userId: clinic.practitioner.userId, primaryBranchId: other.branch.id });

    expect(res.status).toBe(409);
    expect((res.body as Problem).code).toBe('CONFLICT');

    const list = await http(app).get('/api/v1/staff').set(auth(clinic.owner.tokens));
    expect((list.body as { data: StaffBody[] }).data).toHaveLength(1);
  });

  it('başka kiracının profili okunamaz ve güncellenemez', async () => {
    const clinic = await setupClinic(app, { slug: 'klinik-a' });
    const other = await bootstrapTenant(app, { slug: 'klinik-b' });
    const otherAuth = auth(other.owner.tokens);

    const read = await http(app)
      .get(`/api/v1/staff/${clinic.practitioner.staffProfileId}`)
      .set(otherAuth);
    expect(read.status).toBe(404);

    const write = await http(app)
      .patch(`/api/v1/staff/${clinic.practitioner.staffProfileId}`)
      .set(otherAuth)
      .send({ title: 'Ele geçirildi' });
    expect(write.status).toBe(404);
  });

  it('staff:write izni olmayan rol personel düzenleyemez', async () => {
    const clinic = await setupClinic(app);
    const reception = await inviteMember(app, clinic.owner.tokens, {
      email: 'resepsiyon@demo-klinik.test',
      roleKey: 'receptionist',
      branchId: clinic.branch.id,
    });

    const read = await http(app).get('/api/v1/staff').set(auth(reception.tokens));
    expect(read.status).toBe(200);

    const write = await http(app)
      .patch(`/api/v1/staff/${clinic.practitioner.staffProfileId}`)
      .set(auth(reception.tokens))
      .send({ title: 'Yeni unvan' });
    expect(write.status).toBe(403);
    expect((write.body as Problem).code).toBe('FORBIDDEN');
  });

  it('boş gövdeli PATCH kaydı değiştirmeden geri döner', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .patch(`/api/v1/staff/${clinic.practitioner.staffProfileId}`)
      .set(auth(clinic.owner.tokens))
      .send({});

    expect(res.status).toBe(200);
    expect((res.body as StaffBody).title).toBe('Lazer Uzmanı');
  });
});
