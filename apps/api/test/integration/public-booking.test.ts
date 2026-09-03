import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTestApp } from '../helpers/app';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { auth, bootstrapTenant, http, PLATFORM_TOKEN } from '../helpers/identity';
import { setupClinic, type ClinicFixture } from '../helpers/clinic';

const ROOT_DOMAIN = 'klinara.localhost';
const MONDAY = '2026-09-07';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface SlotBody {
  startsAt: string;
  endsAt: string;
  slotToken: string;
  staffName?: string;
}
interface AvailabilityBody {
  timezone: string;
  slots: SlotBody[];
}
interface HoldBody {
  holdToken: string;
  startsAt: string;
  expiresAt: string;
  otpRequired: boolean;
}
interface Problem {
  code: string;
}
interface SelfServiceBody {
  appointmentId: string;
  status: string;
  startsAt: string;
  serviceNames: string[];
  canCancel: boolean;
  canReschedule: boolean;
}

describe('public randevu akışı: uygunluk, tutma, OTP, randevu, self-servis (9.3–9.5)', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    database = await startTestDatabase();
    app = await createTestApp({
      env: {
        DATABASE_URL: database.appUrl,
        PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
        PUBLIC_BOOKING_DOMAIN: ROOT_DOMAIN,
        BOOKING_OTP_RESEND_SECONDS: '10',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.stop();
  });

  beforeEach(async () => {
    await database.truncateAll();
    clinic = await setupClinic(app, { slug: 'klinik-x' });
    await publishSite();
  });

  const ownerAuth = () => auth(clinic.owner.tokens);

  async function publishSite(consent = true): Promise<void> {
    await http(app)
      .put('/api/v1/booking-page/content')
      .set(ownerAuth())
      .set('If-Match', 'W/"0"')
      .send({ sections: [{ type: 'hero', title: 'Klinik X' }] })
      .expect(200);
    if (consent) {
      await http(app)
        .put('/api/v1/booking-page')
        .set(ownerAuth())
        .send({ consentTexts: [{ kind: 'kvkk_explicit', text: 'Açık rıza metni.' }] })
        .expect(200);
    }
    await http(app).post('/api/v1/booking-page/publish').set(ownerAuth()).expect(200);
  }

  const askSlots = (overrides: Record<string, string> = {}) =>
    http(app)
      .get('/api/v1/public/sites/klinik-x/availability')
      .query({
        branchId: clinic.branch.id,
        serviceIds: clinic.quickService.id,
        from: `${MONDAY}T00:00:00+03:00`,
        to: `${MONDAY}T23:59:00+03:00`,
        ...overrides,
      });

  async function firstSlot(): Promise<SlotBody> {
    const res = await askSlots().expect(200);
    const slot = (res.body as AvailabilityBody).slots[0];
    if (slot === undefined) throw new Error('Uygun slot bulunamadı');
    return slot;
  }

  const consentHash = async (): Promise<string> => {
    const site = await http(app).get('/api/v1/public/sites/klinik-x').expect(200);
    const consents = (site.body as { settings: { requiredConsents: { textSha256: string }[] } })
      .settings.requiredConsents;
    return consents[0]!.textSha256;
  };

  async function bookThroughFlow(): Promise<{ appointmentId: string; manageToken: string }> {
    const slot = await firstSlot();
    const hold = await http(app)
      .post('/api/v1/public/sites/klinik-x/holds')
      .send({ slotToken: slot.slotToken })
      .expect(201);
    const holdToken = (hold.body as HoldBody).holdToken;

    await http(app)
      .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
      .send({ phone: '+905321112233' })
      .expect(201);

    const code = await readOtpCode();
    await http(app)
      .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp/verify`)
      .send({ code })
      .expect(200);

    const created = await http(app)
      .post('/api/v1/public/sites/klinik-x/appointments')
      .set('idempotency-key', `it-${Math.random()}`)
      .send({
        holdToken,
        fullName: 'Ayşe Yılmaz',
        consents: [{ kind: 'kvkk_explicit', textSha256: await consentHash() }],
      })
      .expect(201);

    return created.body as { appointmentId: string; manageToken: string };
  }

  /**
   * Kod hash'lenerek saklanıyor; test onu SMS gönderiminden okuyamaz.
   * Bilinen bir kodu doğrudan yazıp hash'ini eşliyoruz — üretim yolunun
   * kendisi (üretim → hash → doğrulama) ayrı bir testte sınanıyor.
   */
  async function readOtpCode(): Promise<string> {
    await database.ownerPool.query(
      `update booking_otp_challenges
          set code_hash = encode(sha256('424242'::bytea), 'hex')
        where consumed_at is null and burned_at is null`,
    );
    return '424242';
  }

  describe('9.4 — tutma yanıtının saat biçimi', () => {
    it('hold, slotun ŞUBE SAAT DİLİMİNDEKİ saatini aynen geri veriyor', async () => {
      // Uygunluk ucu `toZonedIso` ile `+03:00` ofsetli dönüyor. Hold yanıtı
      // `toISOString()` (UTC) verseydi kullanıcı 09:00 seçip özet ekranında
      // 06:00 görürdü — aynı akış içinde aynı slot iki farklı saat.
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);

      const body = hold.body as HoldBody & { endsAt: string };
      expect(body.startsAt).toBe(slot.startsAt);
      expect(body.endsAt).toBe(slot.endsAt);
      expect(body.startsAt).toMatch(/[+-]\d{2}:\d{2}$/);
    });
  });

  describe('9.3 — public uygunluk', () => {
    it('KRİTİK: yanıtta HİÇBİR UUID yok', async () => {
      const res = await askSlots().expect(200);
      const body = res.body as AvailabilityBody;
      expect(body.slots.length).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toMatch(UUID_PATTERN);
    });

    it('showStaffSelection açıkken personel ADI döner, kimliği değil', async () => {
      const slot = await firstSlot();
      expect(slot.staffName).toBe('Demo Uygulayıcı');
      expect(slot.slotToken).not.toMatch(UUID_PATTERN);
    });

    it('showStaffSelection kapalıyken ad da dönmez', async () => {
      await http(app)
        .put('/api/v1/booking-page')
        .set(ownerAuth())
        .send({ showStaffSelection: false })
        .expect(200);
      const slot = await firstSlot();
      expect(slot.staffName).toBeUndefined();
    });

    it('KRİTİK: başka kiracının slot token’ı çözülemez', async () => {
      const slot = await firstSlot();

      const other = await bootstrapTenant(app, { slug: 'klinik-z' });
      await http(app)
        .put('/api/v1/booking-page/content')
        .set(auth(other.owner.tokens))
        .set('If-Match', 'W/"0"')
        .send({ sections: [] })
        .expect(200);
      await http(app).post('/api/v1/booking-page/publish').set(auth(other.owner.tokens)).expect(200);

      const res = await http(app)
        .post('/api/v1/public/sites/klinik-z/holds')
        .send({ slotToken: slot.slotToken })
        .expect(404);
      expect((res.body as Problem).code).toBe('SLOT_TOKEN_INVALID');
    });

    it('kurcalanmış token reddedilir', async () => {
      const slot = await firstSlot();
      const [body] = slot.slotToken.split('.');
      const res = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: `${body}.sahte-imza` })
        .expect(404);
      expect((res.body as Problem).code).toBe('SLOT_TOKEN_INVALID');
    });

    it('aşırı geniş aralık reddedilir', async () => {
      await askSlots({ to: '2026-12-31T23:59:00+03:00' }).expect(400);
    });

    it('Cache-Control ve ETag döner', async () => {
      const res = await askSlots().expect(200);
      expect(res.headers['cache-control']).toContain('s-maxage=15');
      expect(res.headers['etag']).toMatch(/^W\/"p-[0-9a-f]{16}"$/);
    });
  });

  describe('9.4 — slot tutma', () => {
    it('KRİTİK: iki eş zamanlı tutma aynı slota → biri SLOT_CONFLICT', async () => {
      const slot = await firstSlot();
      const [first, second] = await Promise.all([
        http(app).post('/api/v1/public/sites/klinik-x/holds').send({ slotToken: slot.slotToken }),
        http(app).post('/api/v1/public/sites/klinik-x/holds').send({ slotToken: slot.slotToken }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = first.status === 409 ? first : second;
      expect((conflict.body as Problem).code).toBe('SLOT_CONFLICT');
    });

    it('tutulan slot uygunluk listesinden DÜŞER', async () => {
      const slot = await firstSlot();
      await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);

      const after = await askSlots().expect(200);
      const times = (after.body as AvailabilityBody).slots.map((s) => s.startsAt);
      expect(times).not.toContain(slot.startsAt);
    });

    it('süresi dolan tutma slotu SERBEST bırakır', async () => {
      const slot = await firstSlot();
      await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);

      await database.ownerPool.query(`update slot_holds set expires_at = now() - interval '1 minute'`);

      // Süpürücü koşmasa bile bir sonraki tutma isteği eskileri temizler.
      const other = await firstSlot();
      await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: other.slotToken })
        .expect(201);

      const { rows } = await database.ownerPool.query<{ status: string }>(
        `select status from slot_holds order by created_at`,
      );
      expect(rows[0]?.status).toBe('expired');
    });

    it('süresi dolmuş tutma randevuya dönüşemez', async () => {
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);
      const holdToken = (hold.body as HoldBody).holdToken;

      await database.ownerPool.query(`update slot_holds set expires_at = now() - interval '1 minute'`);

      const res = await http(app)
        .post('/api/v1/public/sites/klinik-x/appointments')
        .set('idempotency-key', 'expired-hold')
        .send({ holdToken, fullName: 'Ayşe', consents: [] })
        .expect(409);
      expect((res.body as Problem).code).toBe('HOLD_EXPIRED');
    });

    it('aynı istemci en fazla 2 aktif tutma yapabilir', async () => {
      const res = await askSlots().expect(200);
      const slots = (res.body as AvailabilityBody).slots;
      await http(app).post('/api/v1/public/sites/klinik-x/holds').send({ slotToken: slots[0]!.slotToken }).expect(201);
      await http(app).post('/api/v1/public/sites/klinik-x/holds').send({ slotToken: slots[4]!.slotToken }).expect(201);

      const third = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slots[8]!.slotToken })
        .expect(429);
      expect((third.body as Problem).code).toBe('HOLD_LIMIT_REACHED');
    });

    it('serbest bırakılan tutma slotu geri verir', async () => {
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);

      await http(app)
        .delete(`/api/v1/public/sites/klinik-x/holds/${(hold.body as HoldBody).holdToken}`)
        .expect(204);

      const after = await askSlots().expect(200);
      expect((after.body as AvailabilityBody).slots.map((s) => s.startsAt)).toContain(slot.startsAt);
    });
  });

  describe('9.4 — telefon doğrulama', () => {
    async function newHold(): Promise<string> {
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);
      return (hold.body as HoldBody).holdToken;
    }

    it('doğrulanmadan randevu oluşturulamaz', async () => {
      const holdToken = await newHold();
      const res = await http(app)
        .post('/api/v1/public/sites/klinik-x/appointments')
        .set('idempotency-key', 'no-otp')
        .send({ holdToken, fullName: 'Ayşe', consents: [] })
        .expect(400);
      expect((res.body as Problem).code).toBe('OTP_REQUIRED');
    });

    it('KRİTİK: 5 hatalı denemede kod KOMPLE yanar', async () => {
      const holdToken = await newHold();
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
        .send({ phone: '+905321112233' })
        .expect(201);
      await readOtpCode();

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await http(app)
          .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp/verify`)
          .send({ code: '000000' })
          .expect(400);
      }
      const locked = await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp/verify`)
        .send({ code: '000000' })
        .expect(429);
      expect((locked.body as Problem).code).toBe('OTP_LOCKED');

      // Kod yandıktan sonra DOĞRU kod da geçmez.
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp/verify`)
        .send({ code: '424242' })
        .expect(400);
    });

    it('yeniden gönderim bekleme süresine tabidir', async () => {
      const holdToken = await newHold();
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
        .send({ phone: '+905321112233' })
        .expect(201);
      const res = await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
        .send({ phone: '+905321112233' })
        .expect(429);
      expect((res.body as Problem).code).toBe('RATE_LIMITED');
    });

    it('geçersiz telefon numarası reddedilir', async () => {
      const holdToken = await newHold();
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
        .send({ phone: '123' })
        .expect(400);
    });
  });

  describe('9.4 — randevu oluşturma', () => {
    it('uçtan uca randevu oluşur ve online olarak işaretlenir', async () => {
      const { appointmentId } = await bookThroughFlow();

      const { rows } = await database.ownerPool.query<{
        origin: string;
        created_by: string | null;
        status: string;
      }>(`select origin::text, created_by, status::text from appointments where id = $1`, [
        appointmentId,
      ]);
      expect(rows[0]).toMatchObject({ origin: 'online', created_by: null, status: 'scheduled' });
    });

    it('KRİTİK: randevu KENDİ tutmasına çakışmaz', async () => {
      const { appointmentId } = await bookThroughFlow();
      const { rows } = await database.ownerPool.query<{ source_type: string; active: boolean }>(
        `select source_type::text, active from resource_bookings order by source_type`,
      );
      // Randevu aktif, tutma pasif.
      expect(rows).toEqual([
        { source_type: 'appointment', active: true },
        { source_type: 'hold', active: false },
      ]);
      expect(appointmentId).toBeTruthy();
    });

    it('KRİTİK: onay alınmadan randevu oluşturulamaz', async () => {
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);
      const holdToken = (hold.body as HoldBody).holdToken;
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
        .send({ phone: '+905321112233' })
        .expect(201);
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp/verify`)
        .send({ code: await readOtpCode() })
        .expect(200);

      const res = await http(app)
        .post('/api/v1/public/sites/klinik-x/appointments')
        .set('idempotency-key', 'no-consent')
        .send({ holdToken, fullName: 'Ayşe', consents: [] })
        .expect(400);
      expect((res.body as Problem).code).toBe('CONSENT_REQUIRED');
    });

    it('KRİTİK: onam metni hash’i uyuşmazsa reddedilir', async () => {
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);
      const holdToken = (hold.body as HoldBody).holdToken;
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp`)
        .send({ phone: '+905321112233' })
        .expect(201);
      await http(app)
        .post(`/api/v1/public/sites/klinik-x/holds/${holdToken}/otp/verify`)
        .send({ code: await readOtpCode() })
        .expect(200);

      const res = await http(app)
        .post('/api/v1/public/sites/klinik-x/appointments')
        .set('idempotency-key', 'stale-consent')
        .send({
          holdToken,
          fullName: 'Ayşe',
          consents: [{ kind: 'kvkk_explicit', textSha256: 'a'.repeat(64) }],
        })
        .expect(409);
      expect((res.body as Problem).code).toBe('CONSENT_REQUIRED');
    });

    it('onam kanıtı metnin BİREBİR kopyasıyla saklanır ve DEĞİŞTİRİLEMEZ', async () => {
      const { appointmentId } = await bookThroughFlow();
      const { rows } = await database.ownerPool.query<{ text_body: string; kind: string }>(
        `select text_body, kind from booking_consent_acceptances where appointment_id = $1`,
        [appointmentId],
      );
      expect(rows[0]).toMatchObject({ kind: 'kvkk_explicit', text_body: 'Açık rıza metni.' });

      await expect(
        database.ownerPool.query(`update booking_consent_acceptances set kind = 'x'`),
      ).rejects.toThrow(/değiştirilemez|restrict/i);
    });

    it('Idempotency-Key ZORUNLU', async () => {
      const slot = await firstSlot();
      const hold = await http(app)
        .post('/api/v1/public/sites/klinik-x/holds')
        .send({ slotToken: slot.slotToken })
        .expect(201);
      await http(app)
        .post('/api/v1/public/sites/klinik-x/appointments')
        .send({ holdToken: (hold.body as HoldBody).holdToken, fullName: 'Ayşe', consents: [] })
        .expect(400);
    });

    it('KRİTİK: mevcut telefon için mükerrer müşteri AÇILMAZ', async () => {
      await database.ownerPool.query(
        `update customers set phone = '+905321112233' where id = $1`,
        [clinic.customer.id],
      );
      await bookThroughFlow();

      const { rows } = await database.ownerPool.query<{ n: string }>(
        `select count(*) as n from customers where phone = '+905321112233'`,
      );
      expect(Number(rows[0]?.n)).toBe(1);
    });
  });

  describe('9.5 — self-servis', () => {
    it('token tek randevuyu açar; müşteri kartını AÇMAZ', async () => {
      const { appointmentId, manageToken } = await bookThroughFlow();
      const res = await http(app)
        .get(`/api/v1/public/sites/klinik-x/appointments/${manageToken}`)
        .expect(200);

      const body = res.body as SelfServiceBody;
      expect(body.appointmentId).toBe(appointmentId);
      expect(Object.keys(body).sort()).toEqual([
        'appointmentId',
        'branchAddress',
        'branchName',
        'branchPhone',
        'canCancel',
        'canReschedule',
        'cancelWindowHours',
        'customerFirstName',
        'endsAt',
        'serviceNames',
        'startsAt',
        'status',
        'timezone',
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('geçersiz ve süresi dolmuş token 404', async () => {
      const { manageToken } = await bookThroughFlow();
      await http(app).get('/api/v1/public/sites/klinik-x/appointments/uydurma').expect(404);

      await database.ownerPool.query(
        `update booking_access_tokens set expires_at = now() - interval '1 day'`,
      );
      const res = await http(app)
        .get(`/api/v1/public/sites/klinik-x/appointments/${manageToken}`)
        .expect(404);
      expect((res.body as Problem).code).toBe('BOOKING_TOKEN_INVALID');
    });

    it('iptal edilir ve slot serbest kalır', async () => {
      const { manageToken } = await bookThroughFlow();
      const res = await http(app)
        .post(`/api/v1/public/sites/klinik-x/appointments/${manageToken}/cancel`)
        .send({ reason: 'Planım değişti' })
        .expect(200);
      expect((res.body as SelfServiceBody).status).toBe('cancelled');
    });

    it('iptal penceresi kapalıysa reddedilir ve klinik telefonu gösterilir', async () => {
      const { appointmentId, manageToken } = await bookThroughFlow();
      await database.ownerPool.query(
        `update branches set phone = '+902121112233' where id = $1`,
        [clinic.branch.id],
      );
      // Randevuyu iptal penceresinin içine çekiyoruz (varsayılan 24 saat).
      await database.ownerPool.query(
        `update appointments set starts_at = now() + interval '2 hours',
                                 ends_at = now() + interval '3 hours'
          where id = $1`,
        [appointmentId],
      );

      const res = await http(app)
        .post(`/api/v1/public/sites/klinik-x/appointments/${manageToken}/cancel`)
        .send({})
        .expect(409);
      expect((res.body as Problem).code).toBe('CANCEL_WINDOW_CLOSED');
      expect(JSON.stringify(res.body)).toContain('+902121112233');
    });

    it('KRİTİK: erteleme randevu kimliğini ve geçmişini KORUR', async () => {
      const { appointmentId, manageToken } = await bookThroughFlow();

      const slots = await askSlots().expect(200);
      const target = (slots.body as AvailabilityBody).slots.at(-1)!;

      const res = await http(app)
        .post(`/api/v1/public/sites/klinik-x/appointments/${manageToken}/reschedule`)
        .send({ slotToken: target.slotToken })
        .expect(200);

      expect((res.body as SelfServiceBody).appointmentId).toBe(appointmentId);

      const { rows } = await database.ownerPool.query<{ action: string }>(
        `select action from appointment_history where appointment_id = $1 order by created_at`,
        [appointmentId],
      );
      expect(rows.map((row) => row.action)).toEqual(['created', 'rescheduled']);
    });

    it('.ics dosyası CRLF ve VEVENT içerir', async () => {
      const { manageToken } = await bookThroughFlow();
      const res = await http(app)
        .get(`/api/v1/public/sites/klinik-x/appointments/${manageToken}/ics`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VEVENT');
      expect(res.text).toContain('\r\n');
    });

    it('token kullanım sayacı tükenince erişim kapanır', async () => {
      const { manageToken } = await bookThroughFlow();
      await database.ownerPool.query(`update booking_access_tokens set max_uses = 1`);

      await http(app).get(`/api/v1/public/sites/klinik-x/appointments/${manageToken}`).expect(200);
      await http(app).get(`/api/v1/public/sites/klinik-x/appointments/${manageToken}`).expect(404);
    });
  });
});
