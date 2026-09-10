import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, http, inviteMember, PLATFORM_TOKEN, type Tokens } from '../helpers/identity';
import { branchHeader, setupClinic, type ClinicFixture } from '../helpers/clinic';
import { shiftDays, upcomingMonday } from '../helpers/dates';

interface HolidayBody {
  id: string;
  branchId: string | null;
  holidayDate: string;
  name: string;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

interface Problem {
  code: string;
}

interface AvailabilityBody {
  slots: { startsAt: string }[];
}

/**
 * Pazartesi — `setupClinic` şubesi 09:00–18:00 açık.
 *
 * Uygunluk sorgusu GEÇMİŞ günleri hiç döndürmediği için sabit bir tarih
 * kullanılamaz: takvim her koşuda ileri bir haftaya bakmalı.
 */
const MONDAY = upcomingMonday();
const TUESDAY = shiftDays(MONDAY, 1);

describe('tatiller (Faz 3 devreden madde)', () => {
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

  const createHoliday = (body: Record<string, unknown>, as = ownerAuth()) =>
    http(app).post('/api/v1/holidays').set(as).send(body);

  const listHolidays = (query: Record<string, string> = {}, as = ownerAuth()) =>
    http(app).get('/api/v1/holidays').query(query).set(as);

  const slotsOn = async (date: string): Promise<AvailabilityBody> => {
    const res = await http(app)
      .get('/api/v1/availability')
      .query({
        branchId: clinic.branch.id,
        serviceIds: clinic.quickService.id,
        from: `${date}T00:00:00+03:00`,
        to: `${date}T23:59:59+03:00`,
      })
      .set(ownerAuth())
      .set(branchHeader(clinic.branch.id))
      .expect(200);
    return res.body as AvailabilityBody;
  };

  // -------------------------------------------------------------------------
  it('kiracı geneli tatil TAKVİMİ kapatır ve cache bayat kalmaz', async () => {
    // Önce ölç: tatil yokken gün açık.
    expect((await slotsOn(MONDAY)).slots.length).toBeGreaterThan(0);

    const created = await createHoliday({ holidayDate: MONDAY, name: 'Deneme Bayramı' }).expect(201);
    const body = created.body as HolidayBody;
    expect(body.branchId).toBeNull();
    expect(body.isClosed).toBe(true);

    // Uygunluk cache'i tatil yazımında düşürülmezse gün AÇIK görünmeye devam
    // ederdi — tatil ucunun tek başına hiçbir işe yaramaması demekti.
    expect((await slotsOn(MONDAY)).slots).toHaveLength(0);
  });

  it('ŞUBE kaydı kiracı geneli kaydı EZER: yarım gün açılış', async () => {
    await createHoliday({ holidayDate: MONDAY, name: 'Kiracı geneli kapalı' }).expect(201);
    expect((await slotsOn(MONDAY)).slots).toHaveLength(0);

    // Aynı güne şube kaydı: motor `branch_id nulls last` sıralamasıyla şubeyi
    // tercih ediyor ve şube yarım gün açılıyor.
    await createHoliday({
      branchId: clinic.branch.id,
      holidayDate: MONDAY,
      name: 'Şube yarım gün',
      isClosed: false,
      openTime: '10:00',
      closeTime: '12:00',
    }).expect(201);

    // 15 dk'lık ızgarada 10:00–12:00 arası 30 dk'lık hizmet: 10:00 … 11:30 = 7 slot.
    const slots = (await slotsOn(MONDAY)).slots;
    expect(slots).toHaveLength(7);
    expect(slots[0]?.startsAt).toBe(`${MONDAY}T10:00:00+03:00`);
    expect(slots.at(-1)?.startsAt).toBe(`${MONDAY}T11:30:00+03:00`);
  });

  it('şube süzgeci kiracı geneli kayıtları DA döndürür', async () => {
    await createHoliday({ holidayDate: MONDAY, name: 'Kiracı geneli' }).expect(201);
    await createHoliday({
      branchId: clinic.branch.id,
      holidayDate: TUESDAY,
      name: 'Yalnız şube',
    }).expect(201);

    const res = await listHolidays({ branchId: clinic.branch.id }).expect(200);
    const rows = (res.body as { data: HolidayBody[] }).data;
    // Yalnız şube satırlarını döndürmek, takvimi fiilen kapatan bir kaydı
    // ekranda hiç göstermemek olurdu.
    expect(rows.map((row) => row.name)).toEqual(['Kiracı geneli', 'Yalnız şube']);
  });

  it('tarih aralığı süzgeci gün bazlı ve İKİ UCU DA dahil', async () => {
    for (const [date, name] of [
      ['2026-01-01', 'Yılbaşı'],
      ['2026-04-23', '23 Nisan'],
      ['2026-10-29', '29 Ekim'],
    ] as const) {
      await createHoliday({ holidayDate: date, name }).expect(201);
    }

    const res = await listHolidays({ from: '2026-01-01', to: '2026-04-23' }).expect(200);
    expect((res.body as { data: HolidayBody[] }).data.map((row) => row.name)).toEqual([
      'Yılbaşı',
      '23 Nisan',
    ]);
  });

  // -------------------------------------------------------------------------
  describe('doğrulama', () => {
    it('kapalı güne saat aralığı yazılamaz', async () => {
      const res = await createHoliday({
        holidayDate: MONDAY,
        name: 'Çelişkili',
        openTime: '10:00',
        closeTime: '12:00',
      });
      expect(res.status).toBe(400);
      expect((res.body as Problem).code).toBe('VALIDATION_FAILED');
    });

    it('yarım gün açılışta saatler ZORUNLU ve sıralı', async () => {
      const missing = await createHoliday({
        holidayDate: MONDAY,
        name: 'Eksik',
        isClosed: false,
      });
      expect(missing.status).toBe(400);

      const inverted = await createHoliday({
        holidayDate: MONDAY,
        name: 'Ters',
        isClosed: false,
        openTime: '14:00',
        closeTime: '10:00',
      });
      expect(inverted.status).toBe(400);
    });

    it('tatil bir GÜNDÜR: zaman damgası reddedilir', async () => {
      // `holiday_date` bir `date` kolonu; zaman damgası sessizce güne kırpılır
      // ve istemci hangi günü kapattığını bilemezdi.
      const res = await createHoliday({
        holidayDate: `${MONDAY}T00:00:00+03:00`,
        name: 'Zaman damgalı',
      });
      expect(res.status).toBe(400);
    });

    it('aynı şube ve tarihe İKİNCİ kayıt 409 alır', async () => {
      await createHoliday({ holidayDate: MONDAY, name: 'İlk' }).expect(201);
      const res = await createHoliday({ holidayDate: MONDAY, name: 'İkinci' });
      expect(res.status).toBe(409);
      expect((res.body as Problem).code).toBe('CONFLICT');
    });
  });

  // -------------------------------------------------------------------------
  describe('güncelleme ve kaldırma', () => {
    it('tam kapalıya çevirirken eski saatler TEMİZLENİR', async () => {
      const created = await createHoliday({
        branchId: clinic.branch.id,
        holidayDate: MONDAY,
        name: 'Yarım gün',
        isClosed: false,
        openTime: '10:00',
        closeTime: '12:00',
      }).expect(201);
      const id = (created.body as HolidayBody).id;

      // Saatler gövdede YOK. Süzülüp satırda kalsalardı `holidays_time_window`
      // check constraint'i isteği anlamsız bir 500'e çevirirdi.
      const updated = await http(app)
        .patch(`/api/v1/holidays/${id}`)
        .set(ownerAuth())
        .send({ isClosed: true })
        .expect(200);
      const body = updated.body as HolidayBody;
      expect(body.isClosed).toBe(true);
      expect(body.openTime).toBeNull();
      expect(body.closeTime).toBeNull();

      expect((await slotsOn(MONDAY)).slots).toHaveLength(0);
    });

    it('yalnız ad değişince saatler KORUNUR', async () => {
      const created = await createHoliday({
        holidayDate: MONDAY,
        name: 'Eski ad',
        isClosed: false,
        openTime: '10:00',
        closeTime: '12:00',
      }).expect(201);

      const updated = await http(app)
        .patch(`/api/v1/holidays/${(created.body as HolidayBody).id}`)
        .set(ownerAuth())
        .send({ name: 'Yeni ad' })
        .expect(200);
      const body = updated.body as HolidayBody;
      expect(body.name).toBe('Yeni ad');
      expect(body.openTime).toBe('10:00:00');
      expect(body.closeTime).toBe('12:00:00');
    });

    it('kaldırılan tatil takvimi yeniden AÇAR', async () => {
      const created = await createHoliday({ holidayDate: MONDAY, name: 'Geçici' }).expect(201);
      expect((await slotsOn(MONDAY)).slots).toHaveLength(0);

      await http(app)
        .delete(`/api/v1/holidays/${(created.body as HolidayBody).id}`)
        .set(ownerAuth())
        .expect(204);

      expect((await slotsOn(MONDAY)).slots.length).toBeGreaterThan(0);
      expect((await listHolidays().expect(200)).body).toEqual({ data: [] });
    });
  });

  // -------------------------------------------------------------------------
  describe('kapsam', () => {
    let manager: { userId: string; tokens: Tokens };

    beforeEach(async () => {
      manager = await inviteMember(app, clinic.owner.tokens, {
        email: 'sube-mudur@demo-klinik.test',
        roleKey: 'manager',
        branchId: clinic.branch.id,
      });
    });

    it('şube yöneticisi KİRACI GENELİ tatil yazamaz', async () => {
      // `schedule:write` izni var ama kapsamı kendi şubesi; kiracı geneli bir
      // kayıt TÜM şubelerin takvimini kapatırdı. İzin listesi bu farkı
      // göremez, kapsam kontrolü görebilir.
      const res = await createHoliday({ holidayDate: MONDAY, name: 'Herkese' }, auth(manager.tokens));
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('BRANCH_FORBIDDEN');

      // Kendi şubesine yazabiliyor.
      await createHoliday(
        { branchId: clinic.branch.id, holidayDate: MONDAY, name: 'Şubeye' },
        auth(manager.tokens),
      ).expect(201);
    });

    it('şube yöneticisi kiracı geneli bir kaydı SİLEMEZ', async () => {
      const created = await createHoliday({ holidayDate: MONDAY, name: 'Kiracı geneli' }).expect(201);

      const res = await http(app)
        .delete(`/api/v1/holidays/${(created.body as HolidayBody).id}`)
        .set(auth(manager.tokens));
      expect(res.status).toBe(403);
    });

    it('BAŞKA kiracının şube kimliği 403 BRANCH_FORBIDDEN alır', async () => {
      const other = await setupClinic(app, { slug: 'rakip-klinik' });

      const res = await createHoliday({
        branchId: other.branch.id,
        holidayDate: MONDAY,
        name: 'Sızıntı denemesi',
      });
      expect(res.status).toBe(403);
      expect((res.body as Problem).code).toBe('BRANCH_FORBIDDEN');
    });
  });
});
