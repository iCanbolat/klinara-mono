import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
  conflicts?: { resourceId: string; from: string; to: string; appointmentId: string | null }[];
  suggestions?: { startsAt: string; endsAt: string }[];
}

interface AppointmentBody {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  version: number;
  notes: string | null;
  totalMinor: number;
  services: {
    serviceId: string;
    staffProfileId: string;
    sortOrder: number;
    startsAt: string;
    endsAt: string;
    priceMinor: number;
  }[];
}

const MONDAY = '2026-09-07';
const at = (hhmm: string) => `${MONDAY}T${hhmm}:00+03:00`;

describe('randevu yaşam döngüsü (Batch 3.3)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

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
  });

  const ownerAuth = () => auth(clinic.owner.tokens);
  const branch = () => branchHeader(clinic.branch.id);

  const createBody = (startsAt: string, overrides: Record<string, unknown> = {}) => ({
    branchId: clinic.branch.id,
    customerId: clinic.customer.id,
    startsAt,
    services: [
      { serviceId: clinic.quickService.id, staffProfileId: clinic.practitioner.staffProfileId },
    ],
    ...overrides,
  });

  const create = (startsAt: string, overrides: Record<string, unknown> = {}, headers = {}) =>
    http(app)
      .post('/api/v1/appointments')
      .set(ownerAuth())
      .set(branch())
      .set(headers)
      .send(createBody(startsAt, overrides));

  // -------------------------------------------------------------------------
  describe('oluşturma', () => {
    it('randevuyu kalemleriyle birlikte oluşturur ve fiyatı SNAPSHOT alır', async () => {
      const res = await create(at('10:00'));

      expect(res.status).toBe(201);
      const body = res.body as AppointmentBody;
      expect(body.status).toBe('scheduled');
      expect(body.startsAt).toBe('2026-09-07T10:00:00+03:00');
      expect(body.endsAt).toBe('2026-09-07T10:30:00+03:00');
      expect(body.version).toBe(1);
      expect(body.totalMinor).toBe(50000);
      expect(body.services).toHaveLength(1);
      expect(res.headers.etag).toBe('W/"1"');

      // Katalog fiyatı sonradan değişse de randevunun tutarı değişmemeli.
      await http(app)
        .patch(`/api/v1/services/${clinic.quickService.id}`)
        .set(ownerAuth())
        .send({ priceMinor: 99000 })
        .expect(200);

      const detail = await http(app)
        .get(`/api/v1/appointments/${body.id}`)
        .set(ownerAuth())
        .set(branch());
      expect((detail.body as AppointmentBody).totalMinor).toBe(50000);
    });

    it('ardışık iki hizmeti buffer’larıyla zincirler', async () => {
      const res = await create(at('10:00'), {
        services: [
          { serviceId: clinic.service.id, staffProfileId: clinic.practitioner.staffProfileId },
          { serviceId: clinic.quickService.id, staffProfileId: clinic.practitioner.staffProfileId },
        ],
      });

      expect(res.status).toBe(201);
      const body = res.body as AppointmentBody;
      // 60 dk hizmet 10:00–11:00, ardından 10 dk temizlik + 0 dk hazırlık,
      // ikinci hizmet 11:10–11:40.
      expect(body.services[0]?.startsAt).toBe('2026-09-07T10:00:00+03:00');
      expect(body.services[0]?.endsAt).toBe('2026-09-07T11:00:00+03:00');
      expect(body.services[1]?.startsAt).toBe('2026-09-07T11:10:00+03:00');
      expect(body.endsAt).toBe('2026-09-07T11:40:00+03:00');
    });

    it('çalışma saati dışına randevu açılamaz', async () => {
      const res = await create(at('20:00'));
      expect(res.status).toBe(422);
      expect((res.body as Problem).code).toBe('OUTSIDE_WORKING_HOURS');
    });

    it('yetkin olmayan personele randevu açılamaz', async () => {
      await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/services`)
        .set(ownerAuth())
        .send({ services: [{ serviceId: clinic.service.id, branchId: clinic.branch.id }] })
        .expect(200);

      const res = await create(at('10:00'));
      expect(res.status).toBe(422);
      expect((res.body as Problem).code).toBe('RESOURCE_UNAVAILABLE');
    });

    it('personelin izinli olduğu saate randevu açılamaz', async () => {
      await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(ownerAuth())
        .set(branch())
        .send({
          staffProfileId: clinic.practitioner.staffProfileId,
          branchId: clinic.branch.id,
          startsAt: at('10:00'),
          endsAt: at('11:00'),
        })
        .expect(201);

      const res = await create(at('10:15'));
      expect(res.status).toBe(422);
      expect((res.body as Problem).code).toBe('RESOURCE_UNAVAILABLE');
    });
  });

  // -------------------------------------------------------------------------
  describe('çakışma', () => {
    it('paralel 20 istekten tam olarak biri başarılı olur', async () => {
      const attempts = Array.from({ length: 20 }, () => create(at('11:00')));
      const results = await Promise.all(attempts);

      const created = results.filter((res) => res.status === 201);
      const conflicts = results.filter((res) => res.status === 409);

      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(19);
      expect((conflicts[0]?.body as Problem).code).toBe('SLOT_CONFLICT');
    });

    it('çakışma gövdesi HANGİ kaynağın dolu olduğunu ve alternatif önerir', async () => {
      const first = await create(at('11:00'));
      expect(first.status).toBe(201);

      const second = await create(at('11:00'));
      expect(second.status).toBe(409);

      const problem = second.body as Problem;
      expect(problem.code).toBe('SLOT_CONFLICT');
      expect(problem.conflicts?.[0]?.resourceId).toBe(clinic.practitioner.staffProfileId);
      expect(problem.conflicts?.[0]?.appointmentId).toBe((first.body as AppointmentBody).id);
      expect(problem.suggestions?.length).toBeGreaterThan(0);
      expect(problem.suggestions?.[0]?.startsAt).not.toBe('2026-09-07T11:00:00+03:00');
    });

    it('buffer gölgesindeki randevu da reddedilir', async () => {
      await create(at('11:00'), {
        services: [
          { serviceId: clinic.service.id, staffProfileId: clinic.practitioner.staffProfileId },
        ],
      }).expect(201);

      // 12:00'de biten randevunun 10 dk temizliği 12:10'a kadar sürer.
      const res = await create(at('12:00'));
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('SLOT_CONFLICT');
    });
  });

  // -------------------------------------------------------------------------
  describe('idempotency', () => {
    it('aynı anahtarla iki POST TEK randevu üretir', async () => {
      const key = { 'idempotency-key': 'randevu-1' };

      const first = await create(at('13:00'), {}, key);
      const second = await create(at('13:00'), {}, key);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((second.body as AppointmentBody).id).toBe((first.body as AppointmentBody).id);
    });

    it('aynı anahtar FARKLI gövdeyle 409 verir', async () => {
      const key = { 'idempotency-key': 'randevu-2' };

      await create(at('13:00'), {}, key).expect(201);
      const conflicting = await create(at('14:00'), {}, key);

      expect(conflicting.status).toBe(409);
      expect((conflicting.body as Problem).code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('başarısız istek anahtarı serbest bırakır', async () => {
      const key = { 'idempotency-key': 'randevu-3' };

      const failed = await create(at('20:00'), {}, key);
      expect(failed.status).toBe(422);

      // Aynı anahtarla düzeltilmiş istek geçebilmeli.
      const retried = await create(at('13:00'), {}, key);
      expect(retried.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('optimistic locking', () => {
    it('If-Match olmadan PATCH reddedilir', async () => {
      const created = await create(at('10:00')).expect(201);

      const res = await http(app)
        .patch(`/api/v1/appointments/${(created.body as AppointmentBody).id}`)
        .set(ownerAuth())
        .set(branch())
        .send({ notes: 'not' });

      expect(res.status).toBe(428);
    });

    it('eş zamanlı iki PATCH’te ikincisi VERSION_CONFLICT alır', async () => {
      const created = await create(at('10:00')).expect(201);
      const id = (created.body as AppointmentBody).id;

      const patch = (notes: string) =>
        http(app)
          .patch(`/api/v1/appointments/${id}`)
          .set(ownerAuth())
          .set(branch())
          .set({ 'if-match': 'W/"1"' })
          .send({ notes });

      const first = await patch('birinci');
      expect(first.status).toBe(200);
      expect((first.body as AppointmentBody).version).toBe(2);
      expect(first.headers.etag).toBe('W/"2"');

      const second = await patch('ikinci');
      expect(second.status).toBe(409);
      expect((second.body as Problem).code).toBe('VERSION_CONFLICT');

      const detail = await http(app)
        .get(`/api/v1/appointments/${id}`)
        .set(ownerAuth())
        .set(branch());
      expect((detail.body as AppointmentBody).notes).toBe('birinci');
    });
  });

  // -------------------------------------------------------------------------
  describe('erteleme ve iptal', () => {
    it('erteleme eski slotu serbest bırakır', async () => {
      const created = await create(at('10:00')).expect(201);
      const id = (created.body as AppointmentBody).id;

      const moved = await http(app)
        .post(`/api/v1/appointments/${id}/reschedule`)
        .set(ownerAuth())
        .set(branch())
        .set({ 'if-match': 'W/"1"' })
        .send({ startsAt: at('15:00'), reason: 'Müşteri talebi' });

      expect(moved.status).toBe(200);
      expect((moved.body as AppointmentBody).startsAt).toBe('2026-09-07T15:00:00+03:00');

      // Eski saat yeniden yazılabilmeli.
      const reused = await create(at('10:00'));
      expect(reused.status).toBe(201);
    });

    it('erteleme çakışırsa randevu ESKİ hâlinde kalır', async () => {
      const first = await create(at('10:00')).expect(201);
      const second = await create(at('15:00')).expect(201);

      const moved = await http(app)
        .post(`/api/v1/appointments/${(first.body as AppointmentBody).id}/reschedule`)
        .set(ownerAuth())
        .set(branch())
        .set({ 'if-match': 'W/"1"' })
        .send({ startsAt: at('15:00') });

      expect(moved.status).toBe(409);
      expect((moved.body as Problem).code).toBe('SLOT_CONFLICT');

      // Rollback: ilk randevu hâlâ 10:00'da ve slotu hâlâ dolu.
      const detail = await http(app)
        .get(`/api/v1/appointments/${(first.body as AppointmentBody).id}`)
        .set(ownerAuth())
        .set(branch());
      expect((detail.body as AppointmentBody).startsAt).toBe('2026-09-07T10:00:00+03:00');
      expect((await create(at('10:00'))).status).toBe(409);
      expect((second.body as AppointmentBody).id).toBeDefined();
    });

    it('iptal slotu serbest bırakır ve sebebi saklar', async () => {
      const created = await create(at('10:00')).expect(201);
      const id = (created.body as AppointmentBody).id;

      const cancelled = await http(app)
        .post(`/api/v1/appointments/${id}/cancel`)
        .set(ownerAuth())
        .set(branch())
        .send({ reason: 'Müşteri gelemeyecek' });

      expect(cancelled.status).toBe(200);
      expect((cancelled.body as AppointmentBody).status).toBe('cancelled');

      const reused = await create(at('10:00'));
      expect(reused.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('durum makinesi', () => {
    it('geçerli zinciri yürütür ve geçmişe yazar', async () => {
      const created = await create(at('10:00')).expect(201);
      const id = (created.body as AppointmentBody).id;

      for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
        const res = await http(app)
          .post(`/api/v1/appointments/${id}/status`)
          .set(ownerAuth())
          .set(branch())
          .send({ status });
        expect(res.status).toBe(200);
        expect((res.body as AppointmentBody).status).toBe(status);
      }

      const history = await http(app)
        .get(`/api/v1/appointments/${id}/history`)
        .set(ownerAuth())
        .set(branch());
      const entries = (history.body as { data: { action: string; toStatus: string | null }[] }).data;
      expect(entries).toHaveLength(5); // created + 4 geçiş
      expect(entries.at(-1)?.action).toBe('created');
    });

    it('geçersiz geçişi anlamlı bir hatayla reddeder', async () => {
      const created = await create(at('10:00')).expect(201);

      const res = await http(app)
        .post(`/api/v1/appointments/${(created.body as AppointmentBody).id}/status`)
        .set(ownerAuth())
        .set(branch())
        .send({ status: 'completed' });

      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('tamamlanmış randevuyu geri açmak appointment:reopen ister', async () => {
      const created = await create(at('10:00')).expect(201);
      const id = (created.body as AppointmentBody).id;

      for (const status of ['confirmed', 'arrived', 'in_progress', 'completed']) {
        await http(app)
          .post(`/api/v1/appointments/${id}/status`)
          .set(ownerAuth())
          .set(branch())
          .send({ status })
          .expect(200);
      }

      // Resepsiyon rolünde `appointment:reopen` YOKTUR.
      const reception = await http(app)
        .post('/api/v1/invitations')
        .set(ownerAuth())
        .send({
          email: 'resepsiyon@demo-klinik.test',
          roleKey: 'receptionist',
          branchId: clinic.branch.id,
          fullName: 'Resepsiyon',
        });
      const accepted = await http(app)
        .post(`/api/v1/invitations/token/${(reception.body as { token: string }).token}/accept`)
        .send({ password: 'cok-gizli-parola-123' });
      const receptionTokens = (accepted.body as { tokens: { accessToken: string } }).tokens
        .accessToken;

      const denied = await http(app)
        .post(`/api/v1/appointments/${id}/status`)
        .set(auth(receptionTokens))
        .set(branch())
        .send({ status: 'in_progress' });
      expect(denied.status).toBe(403);

      const allowed = await http(app)
        .post(`/api/v1/appointments/${id}/status`)
        .set(ownerAuth())
        .set(branch())
        .send({ status: 'in_progress' });
      expect(allowed.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('kiracı izolasyonu ve görünürlük', () => {
    it('başka kiracının randevusu okunamaz', async () => {
      const created = await create(at('10:00')).expect(201);
      const other = await bootstrapTenant(app, { slug: 'klinik-b' });

      const res = await http(app)
        .get(`/api/v1/appointments/${(created.body as AppointmentBody).id}`)
        .set(auth(other.owner.tokens))
        .set(branchHeader(other.branch.id));

      expect(res.status).toBe(404);
    });

    it('uygulayıcı KENDİ randevusunu görür', async () => {
      const created = await create(at('10:00')).expect(201);

      const res = await http(app)
        .get(`/api/v1/appointments/${(created.body as AppointmentBody).id}`)
        .set(auth(clinic.practitioner.tokens))
        .set(branch());

      expect(res.status).toBe(200);
    });

    it('geçmiş kaydı değiştirilemez', async () => {
      const created = await create(at('10:00')).expect(201);
      const id = (created.body as AppointmentBody).id;

      await expect(
        database.appPool.query(
          `select set_config('app.tenant_id', $1, false);
           update appointment_history set reason = 'değiştirildi' where appointment_id = $2`,
          [clinic.tenant.id, id],
        ),
      ).rejects.toThrow();
    });
  });
});
