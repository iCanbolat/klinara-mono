import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, inviteMember, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type CustomerBody } from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
  errors?: { path: string; message: string }[];
}

interface CustomerDetail extends CustomerBody {
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  notes: string | null;
}

describe('müşteri çekirdeği (Batch 3.0)', () => {
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
  it('telefonu E.164’e normalize eder', async () => {
    const clinic = await setupClinic(app);
    expect(clinic.customer.phone).toBe('+905321234567');
  });

  it('farklı yazımlar aynı numaraya çözülür ve tekrarı reddedilir', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    for (const raw of ['+90 532 123 45 67', '905321234567', '0532-123-45-67']) {
      const res = await http(app)
        .post('/api/v1/customers')
        .set(ownerAuth)
        .send({ fullName: 'Kopya Kayıt', phone: raw });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    }
  });

  it('geçersiz numarayı alan bazlı hatayla reddeder', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .post('/api/v1/customers')
      .set(auth(clinic.owner.tokens))
      .send({ fullName: 'Hatalı Numara', phone: '12' });

    expect(res.status).toBe(400);
    const problem = res.body as Problem;
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.[0]?.path).toBe('phone');
  });

  it('telefonsuz müşteri açılabilir ve tekillik onları kapsamaz', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    for (const name of ['Telefonsuz Bir', 'Telefonsuz İki']) {
      const res = await http(app).post('/api/v1/customers').set(ownerAuth).send({ fullName: name });
      expect(res.status).toBe(201);
      expect((res.body as CustomerDetail).phone).toBeNull();
    }
  });

  it('güncelleme yapar; null gönderimi alanı temizler', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    const updated = await http(app)
      .patch(`/api/v1/customers/${clinic.customer.id}`)
      .set(ownerAuth)
      .send({ fullName: 'Ayşe Yılmaz Demir', birthDate: '1990-05-12', gender: 'female' });
    expect(updated.status).toBe(200);
    expect((updated.body as CustomerDetail).fullName).toBe('Ayşe Yılmaz Demir');
    expect((updated.body as CustomerDetail).birthDate).toBe('1990-05-12');

    const cleared = await http(app)
      .patch(`/api/v1/customers/${clinic.customer.id}`)
      .set(ownerAuth)
      .send({ phone: null });
    expect(cleared.status).toBe(200);
    expect((cleared.body as CustomerDetail).phone).toBeNull();

    // Numara serbest kaldığına göre başka bir karta yazılabilmeli.
    const reused = await http(app)
      .post('/api/v1/customers')
      .set(ownerAuth)
      .send({ fullName: 'Yeni Sahip', phone: '0532 123 45 67' });
    expect(reused.status).toBe(201);
  });

  it('boş gövdeli PATCH kaydı değiştirmeden geri döner', async () => {
    const clinic = await setupClinic(app);

    const res = await http(app)
      .patch(`/api/v1/customers/${clinic.customer.id}`)
      .set(auth(clinic.owner.tokens))
      .send({});

    expect(res.status).toBe(200);
    expect((res.body as CustomerDetail).fullName).toBe('Ayşe Yılmaz');
  });

  it('arşivlenen müşteri listeden çıkar ama numarası serbest kalır', async () => {
    const clinic = await setupClinic(app);
    const ownerAuth = auth(clinic.owner.tokens);

    const removed = await http(app)
      .delete(`/api/v1/customers/${clinic.customer.id}`)
      .set(ownerAuth);
    expect(removed.status).toBe(200);

    const list = await http(app).get('/api/v1/customers').set(ownerAuth);
    expect((list.body as { data: CustomerDetail[] }).data).toHaveLength(0);

    const detail = await http(app)
      .get(`/api/v1/customers/${clinic.customer.id}`)
      .set(ownerAuth);
    expect(detail.status).toBe(404);

    const recreated = await http(app)
      .post('/api/v1/customers')
      .set(ownerAuth)
      .send({ fullName: 'Ayşe Yılmaz', phone: '0532 123 45 67' });
    expect(recreated.status).toBe(201);
  });

  it('bir kiracının müşterisi diğerinin context’inde ne okunur ne yazılır', async () => {
    const clinic = await setupClinic(app, { slug: 'klinik-a' });
    const other = await bootstrapTenant(app, { slug: 'klinik-b' });
    const otherAuth = auth(other.owner.tokens);

    const list = await http(app).get('/api/v1/customers').set(otherAuth);
    expect((list.body as { data: CustomerDetail[] }).data).toHaveLength(0);

    const detail = await http(app)
      .get(`/api/v1/customers/${clinic.customer.id}`)
      .set(otherAuth);
    expect(detail.status).toBe(404);

    const write = await http(app)
      .patch(`/api/v1/customers/${clinic.customer.id}`)
      .set(otherAuth)
      .send({ fullName: 'Ele geçirildi' });
    expect(write.status).toBe(404);

    // Aynı numara BAŞKA kiracıda serbesttir: tekillik kiracı içindedir.
    const sameNumber = await http(app)
      .post('/api/v1/customers')
      .set(otherAuth)
      .send({ fullName: 'Başka Klinik Müşterisi', phone: '0532 123 45 67' });
    expect(sameNumber.status).toBe(201);
  });

  it('customer:write izni olmayan rol müşteri oluşturamaz', async () => {
    const clinic = await setupClinic(app);
    const accountant = await inviteMember(app, clinic.owner.tokens, {
      email: 'muhasebe@demo-klinik.test',
      roleKey: 'accountant',
    });

    const read = await http(app).get('/api/v1/customers').set(auth(accountant.tokens));
    expect(read.status).toBe(200);

    const write = await http(app)
      .post('/api/v1/customers')
      .set(auth(accountant.tokens))
      .send({ fullName: 'Muhasebeden' });
    expect(write.status).toBe(403);
  });
});
