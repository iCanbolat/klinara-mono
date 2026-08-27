import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN } from '../helpers/identity';
import {
  branchHeader,
  setupClinic,
  weeklyBranchHours,
  weeklyStaffSchedule,
  SUNDAY,
} from '../helpers/clinic';

interface Problem {
  code: string;
  status: number;
}

interface HourEntry {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

interface ExceptionBody {
  id: string;
  staffProfileId: string;
  startsAt: string;
  endsAt: string;
  recurrenceType: string;
  recurrenceWeekdays: number[];
  isActive: boolean;
}

describe('çalışma saatleri ve istisnalar', () => {
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
  describe('şube çalışma saatleri', () => {
    it('yedi günü birden yazar ve mola aralığını korur', async () => {
      const clinic = await setupClinic(app, {
        branchHours: weeklyBranchHours({ breakStartTime: '13:00', breakEndTime: '14:00' }),
      });

      const res = await http(app)
        .get(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id));

      expect(res.status).toBe(200);
      const entries = (res.body as { entries: HourEntry[] }).entries;
      expect(entries).toHaveLength(7);

      const monday = entries.find((e) => e.dayOfWeek === 1);
      expect(monday?.openTime).toBe('09:00:00');
      expect(monday?.closeTime).toBe('18:00:00');
      expect(monday?.breakStartTime).toBe('13:00:00');

      const sunday = entries.find((e) => e.dayOfWeek === SUNDAY);
      expect(sunday?.isClosed).toBe(true);
      expect(sunday?.openTime).toBeNull();
    });

    it('eksik gün gönderilen toplu yazımı reddeder', async () => {
      const clinic = await setupClinic(app);

      const res = await http(app)
        .put(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({ entries: weeklyBranchHours().slice(0, 5) });

      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('kapalı güne saat aralığı yazılamaz', async () => {
      const clinic = await setupClinic(app);
      const entries = weeklyBranchHours().map((entry) =>
        entry.dayOfWeek === SUNDAY
          ? { dayOfWeek: SUNDAY, isClosed: true, openTime: '09:00', closeTime: '18:00' }
          : entry,
      );

      const res = await http(app)
        .put(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({ entries });

      expect(res.status).toBe(400);
    });

    it('X-Branch-Id başlığı olmadan çalışmaz', async () => {
      const clinic = await setupClinic(app);

      const res = await http(app)
        .get(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(auth(clinic.owner.tokens));

      expect(res.status).toBe(400);
    });

    it('farklı saat dilimindeki iki şube birbirini etkilemez', async () => {
      const clinic = await setupClinic(app);
      const ownerAuth = auth(clinic.owner.tokens);

      // Türkiye kalıcı UTC+3'tedir (2016'dan beri DST yok). Yaz saati geçişinin
      // saatleri KAYDIRMADIĞINI gerçekten sınamak için DST uygulayan bir şube
      // kuruyoruz — kural motorunun özelliği, ülkenin değil.
      const berlin = await http(app)
        .post('/api/v1/branches')
        .set(ownerAuth)
        .send({ slug: 'berlin', name: 'Berlin Şube', timezone: 'Europe/Berlin' });
      expect(berlin.status).toBe(201);
      const berlinId = (berlin.body as { id: string; timezone: string }).id;
      expect((berlin.body as { timezone: string }).timezone).toBe('Europe/Berlin');

      await http(app)
        .put(`/api/v1/branches/${berlinId}/hours`)
        .set(ownerAuth)
        .set(branchHeader(berlinId))
        .send({ entries: weeklyBranchHours({ openTime: '08:00', closeTime: '16:00' }) })
        .expect(200);

      const istanbul = await http(app)
        .get(`/api/v1/branches/${clinic.branch.id}/hours`)
        .set(ownerAuth)
        .set(branchHeader(clinic.branch.id));
      const istanbulMonday = (istanbul.body as { entries: HourEntry[] }).entries.find(
        (e) => e.dayOfWeek === 1,
      );
      expect(istanbulMonday?.openTime).toBe('09:00:00');

      const berlinHours = await http(app)
        .get(`/api/v1/branches/${berlinId}/hours`)
        .set(ownerAuth)
        .set(branchHeader(berlinId));
      const berlinMonday = (berlinHours.body as { entries: HourEntry[] }).entries.find(
        (e) => e.dayOfWeek === 1,
      );
      expect(berlinMonday?.openTime).toBe('08:00:00');
    });
  });

  // -------------------------------------------------------------------------
  describe('personel haftalık şablonu', () => {
    it('şube bazlı yazılır ve okunur', async () => {
      const clinic = await setupClinic(app, {
        staffSchedule: weeklyStaffSchedule({ startTime: '10:00', endTime: '17:00', offDays: [0, 6] }),
      });

      const res = await http(app)
        .get(`/api/v1/staff/${clinic.practitioner.staffProfileId}/schedule`)
        .query({ branchId: clinic.branch.id })
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id));

      expect(res.status).toBe(200);
      const entries = (res.body as { entries: { dayOfWeek: number; isOff: boolean; startTime: string | null }[] })
        .entries;
      expect(entries).toHaveLength(7);
      expect(entries.find((e) => e.dayOfWeek === 6)?.isOff).toBe(true);
      expect(entries.find((e) => e.dayOfWeek === 3)?.startTime).toBe('10:00:00');
    });

    it('izinli güne saat yazılamaz', async () => {
      const clinic = await setupClinic(app);
      const entries = weeklyStaffSchedule().map((entry) =>
        entry.dayOfWeek === SUNDAY
          ? { dayOfWeek: SUNDAY, isOff: true, startTime: '09:00', endTime: '18:00' }
          : entry,
      );

      const res = await http(app)
        .put(`/api/v1/staff/${clinic.practitioner.staffProfileId}/schedule`)
        .set(auth(clinic.owner.tokens))
        .set(branchHeader(clinic.branch.id))
        .send({ branchId: clinic.branch.id, entries });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('istisnalar', () => {
    it('tek seferlik istisna oluşturur, listeler ve pasife alır', async () => {
      const clinic = await setupClinic(app);
      const ownerAuth = auth(clinic.owner.tokens);
      const branch = branchHeader(clinic.branch.id);

      const created = await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(ownerAuth)
        .set(branch)
        .send({
          staffProfileId: clinic.practitioner.staffProfileId,
          branchId: clinic.branch.id,
          startsAt: '2026-09-01T10:00:00+03:00',
          endsAt: '2026-09-01T12:00:00+03:00',
          reason: 'Eğitim',
        });

      expect(created.status).toBe(201);
      const exception = created.body as ExceptionBody;
      expect(exception.recurrenceType).toBe('none');
      // Sunucu UTC saklar; +03:00 girdisi aynı ANI temsil eder.
      expect(new Date(exception.startsAt).toISOString()).toBe('2026-09-01T07:00:00.000Z');

      const list = await http(app)
        .get('/api/v1/schedule-exceptions')
        .query({ branchId: clinic.branch.id })
        .set(ownerAuth)
        .set(branch);
      expect((list.body as { data: ExceptionBody[] }).data).toHaveLength(1);

      const removed = await http(app)
        .delete(`/api/v1/schedule-exceptions/${exception.id}`)
        .set(ownerAuth)
        .set(branch);
      expect(removed.status).toBe(204);

      const after = await http(app)
        .get('/api/v1/schedule-exceptions')
        .query({ branchId: clinic.branch.id })
        .set(ownerAuth)
        .set(branch);
      expect((after.body as { data: ExceptionBody[] }).data).toHaveLength(0);
    });

    it('haftalık tekrarda bitiş tarihi ve gün listesi zorunludur', async () => {
      const clinic = await setupClinic(app);
      const ownerAuth = auth(clinic.owner.tokens);
      const branch = branchHeader(clinic.branch.id);
      const base = {
        staffProfileId: clinic.practitioner.staffProfileId,
        branchId: clinic.branch.id,
        startsAt: '2026-09-01T10:00:00+03:00',
        endsAt: '2026-09-01T12:00:00+03:00',
        recurrenceType: 'weekly',
      };

      const missingUntil = await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(ownerAuth)
        .set(branch)
        .send({ ...base, recurrenceWeekdays: [2] });
      expect(missingUntil.status).toBe(400);

      const missingDays = await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(ownerAuth)
        .set(branch)
        .send({ ...base, recurrenceUntil: '2026-12-01T00:00:00+03:00' });
      expect(missingDays.status).toBe(400);

      const ok = await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(ownerAuth)
        .set(branch)
        .send({
          ...base,
          recurrenceUntil: '2026-12-01T00:00:00+03:00',
          recurrenceWeekdays: [2],
        });
      expect(ok.status).toBe(201);
      expect((ok.body as ExceptionBody).recurrenceWeekdays).toEqual([2]);
    });

    it('BAŞKA kiracının personeline istisna yazılamaz', async () => {
      const clinic = await setupClinic(app, { slug: 'klinik-a' });
      const other = await bootstrapTenant(app, { slug: 'klinik-b' });

      const res = await http(app)
        .post('/api/v1/schedule-exceptions')
        .set(auth(other.owner.tokens))
        .set(branchHeader(other.branch.id))
        .send({
          staffProfileId: clinic.practitioner.staffProfileId,
          branchId: other.branch.id,
          startsAt: '2026-09-01T10:00:00+03:00',
          endsAt: '2026-09-01T12:00:00+03:00',
        });

      // FK doğrulaması RLS'i bypass eder: kimlik geçerli görünür, kuralı
      // kapsam trigger'ı tutar ve anlamlı bir 409'a çevrilir.
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });

    it('BAŞKA kiracının şube kimliği 403 BRANCH_FORBIDDEN alır', async () => {
      // Faz 3'te bu kontrol yoktu: `canAccessBranch` kiracı geneli rolleri
      // (owner/accountant) tüm şubelere açıyor ve şubenin gerçekten bu
      // kiracıya ait olduğunu sormuyordu. Yabancı kimlik uygulama katmanından
      // geçiyor, sızıntıyı yalnız RLS ve kapsam trigger'ı engelliyordu — yani
      // çağıran ilgisiz bir hata alıyordu. Artık `BranchAccessService` aidiyeti
      // de doğruluyor ve kapı ilk adımda kapanıyor.
      const clinic = await setupClinic(app, { slug: 'klinik-a' });
      const other = await bootstrapTenant(app, { slug: 'klinik-b' });
      const clinicAuth = auth(clinic.owner.tokens);

      // Başlık yolu: guard'da durur.
      const header = await http(app)
        .get('/api/v1/schedule-exceptions')
        .query({ branchId: clinic.branch.id })
        .set(clinicAuth)
        .set(branchHeader(other.branch.id));
      expect(header.status).toBe(403);
      expect((header.body as Problem).code).toBe('BRANCH_FORBIDDEN');

      // Sorgu parametresi yolu: servis katmanında durur.
      const read = await http(app)
        .get('/api/v1/schedule-exceptions')
        .query({ branchId: other.branch.id })
        .set(clinicAuth)
        .set(branchHeader(clinic.branch.id));
      expect(read.status).toBe(403);
      expect((read.body as Problem).code).toBe('BRANCH_FORBIDDEN');

      // Yazım yolu: artık kapsam trigger'ının 409'una hiç ulaşmıyor.
      const write = await http(app)
        .put(`/api/v1/branches/${other.branch.id}/hours`)
        .set(clinicAuth)
        .set(branchHeader(clinic.branch.id))
        .send({ entries: weeklyBranchHours() });
      expect(write.status).toBe(403);
      expect((write.body as Problem).code).toBe('BRANCH_FORBIDDEN');
    });

    it('yeni açılan şube ERİŞİM CACHE\'i yüzünden 403 almaz', async () => {
      // Şube kimlikleri süreç-içi cache'te duruyor; yazımda invalide
      // edilmeseydi yeni şube TTL boyunca "bu kiracıya ait değil" görünür,
      // yani açıldığı dakika kullanılamazdı.
      const clinic = await setupClinic(app, { slug: 'klinik-a' });
      const clinicAuth = auth(clinic.owner.tokens);

      // Cache'i doldur.
      await http(app).get('/api/v1/branches').set(clinicAuth).set(branchHeader(clinic.branch.id));

      const created = await http(app)
        .post('/api/v1/branches')
        .set(clinicAuth)
        .send({ slug: 'ikinci-sube', name: 'İkinci Şube' });
      expect(created.status).toBe(201);
      const branchId = (created.body as { id: string }).id;

      const res = await http(app)
        .get('/api/v1/schedule-exceptions')
        .query({ branchId })
        .set(clinicAuth)
        .set(branchHeader(branchId));
      expect(res.status).toBe(200);
    });
  });
});
