import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@klinara/shared';
import { generateNumericCode, generateOpaqueToken, safeEqual, sha256 } from '../../common/crypto/tokens';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { normalizePhone } from '../../common/phone';
import type { EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import { AppointmentsService } from '../booking/appointments.service';
import * as appointmentRepo from '../booking/appointments.repository';
import * as pageRepo from '../booking-page/booking-page.repository';
import { BookingOtpSender } from './booking-otp.sender';
import * as repo from './holds.repository';
import { SlotTokenService } from './slot-token.service';
import type { PublicSiteContext } from './public-site-resolver.service';
import type {
  ConsentAcceptanceDto,
  HoldResponseDto,
  PublicCreateAppointmentDto,
} from './dto/public-booking.dto';

interface ConsentSetting {
  kind: string;
  text: string;
  required?: boolean;
}

/** İstek izi — onam kanıtına yazılır. */
export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly slotTokens: SlotTokenService,
    private readonly appointments: AppointmentsService,
    private readonly cache: AvailabilityCacheService,
    private readonly otpSender: BookingOtpSender,
  ) {}

  // ---------------------------------------------------------------------------
  // Slot tutma
  // ---------------------------------------------------------------------------
  /**
   * Slotu tutar.
   *
   * ÇEKİRDEK GARANTİ burada değil, `resource_bookings`ta: tutma oraya
   * `source_type='hold'` olarak yazılıyor ve randevunun kullandığı AYNI GIST
   * EXCLUDE constraint'i tarafından korunuyor. İki eş zamanlı istek aynı slota
   * geldiğinde ikincisi `23P01` ile düşer — uygulama seviyesinde bir kilit
   * ikisini de geçirebilirdi.
   */
  async createHold(
    site: PublicSiteContext,
    slotToken: string,
    meta: ClientMeta,
    now: Date = new Date(),
  ): Promise<HoldResponseDto> {
    const claim = this.slotTokens.verify(slotToken, site.tenantId, now);

    const settings = await this.tx.run((tx) => pageRepo.findSettings(tx, site.siteId));
    const ttlMinutes =
      settings?.holdTtlMinutes ?? this.config.get('SLOT_HOLD_TTL_MINUTES', { infer: true });
    const expiresAt = new Date(now.getTime() + Number(ttlMinutes) * 60_000);

    const token = generateOpaqueToken();
    const tokenHash = sha256(token);

    const hold = await this.tx
      .run(async (tx) => {
        // Süresi dolmuş tutmalar ÖNCE temizleniyor: kuyruk kapalıysa
        // (`QUEUE_ENABLED=false`) ya da bir iş kaçtıysa, süresi dolmuş bir
        // tutma EXCLUDE constraint'inde hâlâ yer kaplıyor olurdu.
        await repo.expireStaleHolds(tx, now);

        const active = await repo.countActiveHolds(
          tx,
          { clientIp: meta.ip, phone: null },
          now,
        );
        if (active >= this.config.get('BOOKING_HOLD_MAX_ACTIVE', { infer: true })) {
          throw new AppError(
            429,
            ERROR_CODES.HOLD_LIMIT_REACHED,
            'Aynı anda tutabileceğiniz saat sayısını aştınız',
            { detail: 'Önceki seçiminizi tamamlayın ya da serbest bırakın.' },
          );
        }

        const created = await repo.insertHold(tx, {
          tenantId: site.tenantId,
          branchId: claim.branchId,
          bookingSiteId: site.siteId,
          tokenHash,
          serviceIds: claim.serviceIds,
          staffProfileId: claim.staffProfileId === '' ? null : claim.staffProfileId,
          startsAt: new Date(claim.startsAt),
          endsAt: new Date(claim.endsAt),
          expiresAt,
          clientIp: meta.ip,
        });

        if (claim.staffProfileId !== '') {
          await appointmentRepo.insertHoldBooking(tx, {
            tenantId: site.tenantId,
            branchId: claim.branchId,
            staffProfileId: claim.staffProfileId,
            holdId: created.id,
            from: new Date(claim.startsAt),
            to: new Date(claim.endsAt),
          });
        }
        return created;
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.EXCLUSION_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.SLOT_CONFLICT, 'Bu saat az önce alındı', {
            detail: 'Lütfen uygun saatleri yeniden listeleyin.',
          });
        }
        throw error;
      });

    // Tutma da bir işgaldir: uygunluk cache'i düşmezse aynı slot 30 saniye
    // daha "boş" görünürdü.
    this.cache.invalidateTenant(site.tenantId);

    return {
      holdToken: token,
      startsAt: hold.startsAt.toISOString(),
      endsAt: hold.endsAt.toISOString(),
      expiresAt: hold.expiresAt.toISOString(),
      otpRequired: settings?.requireOtp ?? true,
      otpVerified: false,
    };
  }

  async releaseHold(site: PublicSiteContext, holdToken: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const hold = await this.requireHold(tx, site, holdToken, new Date(), {
        allowExpired: true,
      });
      if (hold.status !== 'active') return;
      await repo.updateHold(tx, hold.id, { status: 'released' });
      await appointmentRepo.deactivateHoldBooking(tx, hold.id);
    });
    this.cache.invalidateTenant(site.tenantId);
  }

  // ---------------------------------------------------------------------------
  // Telefon doğrulama
  // ---------------------------------------------------------------------------
  async requestOtp(
    site: PublicSiteContext,
    holdToken: string,
    rawPhone: string,
    meta: ClientMeta,
    now: Date = new Date(),
  ): Promise<{ sentAt: string; expiresAt: string }> {
    const phone = normalizePhone(rawPhone);
    if (phone === null) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Telefon numarası geçersiz');
    }

    const ttlMinutes = this.config.get('BOOKING_OTP_TTL_MINUTES', { infer: true });
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    const code = generateNumericCode(6);

    const clinicName = await this.tx.run(async (tx) => {
      const hold = await this.requireHold(tx, site, holdToken, now);
      await this.assertOtpQuota(tx, site, phone, now);

      // Yeniden gönderimde eski kod YANAR: iki geçerli kodun aynı anda
      // dolaşması, deneme sınırını fiilen ikiye katlardı.
      await repo.burnOpenChallenges(tx, hold.id, now);
      await repo.insertOtpChallenge(tx, {
        tenantId: site.tenantId,
        bookingSiteId: site.siteId,
        slotHoldId: hold.id,
        phone,
        codeHash: sha256(code),
        expiresAt,
        clientIp: meta.ip,
      });

      const result = await tx.execute<{ name: string }>(sql`select name from tenants limit 1`);
      return result.rows[0]?.name ?? 'Klinik';
    });

    const settings = await this.tx.run((tx) => pageRepo.findSettings(tx, site.siteId));

    // Gönderim transaction DIŞINDA: sağlayıcı yavaşsa bir veritabanı
    // bağlantısını ağ gecikmesi boyunca tutmuş olurduk. Kod zaten yazıldı;
    // gönderim başarısız olursa kullanıcı yeniden isteyebilir.
    await this.otpSender.send({
      tenantId: site.tenantId,
      channel: settings?.otpChannel ?? 'whatsapp',
      phone,
      code,
      clinicName,
    });

    return { sentAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
  }

  /**
   * Kodu doğrular.
   *
   * ⚠️ SAYAÇ AYRI TRANSACTION'DA. Hatalı denemeyi, isteği REDDEDEN
   * transaction'ın içinde yazmak sessizce işe yaramaz: `AppError` fırlatınca
   * transaction rollback olur ve `attempts` artışı da geri alınır — kod hiç
   * yanmaz, brute-force koruması fiilen yok olur. Bu, `IdempotencyService`in
   * "kilit ve iş ayrı transaction'larda" kararıyla aynı ders.
   */
  async verifyOtp(
    site: PublicSiteContext,
    holdToken: string,
    code: string,
    now: Date = new Date(),
  ): Promise<{ verified: true }> {
    const loaded = await this.tx.run(async (tx) => {
      const hold = await this.requireHold(tx, site, holdToken, now);
      const challenge = await repo.findOpenChallenge(tx, hold.id);
      return { hold, challenge };
    });

    const { hold, challenge } = loaded;
    if (challenge === undefined) {
      throw new AppError(400, ERROR_CODES.OTP_REQUIRED, 'Önce doğrulama kodu isteyin');
    }

    if (challenge.expiresAt <= now) {
      await this.tx.run((tx) => repo.updateChallenge(tx, challenge.id, { burnedAt: now }));
      throw new AppError(400, ERROR_CODES.VERIFICATION_FAILED, 'Kodun süresi doldu');
    }

    if (!safeEqual(sha256(code), challenge.codeHash)) {
      const attempts = challenge.attempts + 1;
      const max = this.config.get('BOOKING_OTP_MAX_ATTEMPTS', { infer: true });
      const burned = attempts >= max;

      // Önce YAZ, sonra fırlat. Kod komple yanıyor; kalan deneme sayılmıyor
      // ki "kaçıncı denemede bildi" diye bir yol kalmasın.
      await this.tx.run((tx) =>
        repo.updateChallenge(tx, challenge.id, {
          attempts,
          ...(burned ? { burnedAt: now } : {}),
        }),
      );

      if (burned) {
        throw new AppError(429, ERROR_CODES.OTP_LOCKED, 'Çok fazla hatalı deneme', {
          detail: 'Yeni bir kod isteyin.',
        });
      }
      throw new AppError(400, ERROR_CODES.VERIFICATION_FAILED, 'Kod hatalı');
    }

    await this.tx.run(async (tx) => {
      await repo.updateChallenge(tx, challenge.id, { consumedAt: now });
      // Doğrulama HOLD'a bağlanıyor; ortalıkta ayrı bir "doğrulanmış telefon"
      // token'ı dolaşmıyor.
      await repo.updateHold(tx, hold.id, {
        otpVerifiedAt: now,
        verifiedPhone: challenge.phone,
      });
    });

    return { verified: true };
  }

  // ---------------------------------------------------------------------------
  // Randevu oluşturma
  // ---------------------------------------------------------------------------
  async createAppointment(
    site: PublicSiteContext,
    input: PublicCreateAppointmentDto,
    meta: ClientMeta,
    now: Date = new Date(),
  ): Promise<{ appointmentId: string; manageToken: string }> {
    const prepared = await this.tx.run(async (tx) => {
      const hold = await this.requireHold(tx, site, input.holdToken, now);
      const settings = await pageRepo.findSettings(tx, site.siteId);

      if ((settings?.requireOtp ?? true) && hold.otpVerifiedAt === null) {
        throw new AppError(400, ERROR_CODES.OTP_REQUIRED, 'Telefon doğrulaması gerekli');
      }
      assertConsents((settings?.consentTexts ?? []) as ConsentSetting[], input.consents);

      const phone = hold.verifiedPhone;
      const customerId = await resolveCustomer(tx, site.tenantId, {
        phone,
        fullName: input.fullName,
        email: input.email ?? null,
        gender: input.gender ?? null,
      });

      return { hold, settings, customerId };
    });

    const { hold, settings, customerId } = prepared;
    const services = hold.serviceIds.map((serviceId) => ({
      serviceId,
      staffProfileId: hold.staffProfileId ?? '',
    }));

    const appointment = await this.appointments.createUnauthorized({
      branchId: hold.branchId,
      customerId,
      startsAt: hold.startsAt.toISOString(),
      services,
      notes: input.notes,
      // ⚠️ SIRA KRİTİK: tutma randevu satırları yazılmadan ÖNCE serbest
      // bırakılıyor. Aksi hâlde randevu KENDİ tutmasına çakışır ve akış
      // `SLOT_CONFLICT` ile düşerdi.
      prepare: async (tx) => {
        await appointmentRepo.deactivateHoldBooking(tx, hold.id);
        await repo.updateHold(tx, hold.id, { status: 'converted' });
      },
    });

    // Onam kanıtı ve self-servis token'ı randevudan SONRA, ayrı transaction'da:
    // randevu yazımı çakışmayla düşerse bunların da yazılmaması gerekiyordu ve
    // düşmüş bir transaction'da devam edilemez.
    const manageToken = generateOpaqueToken();
    await this.tx.run(async (tx) => {
      for (const consent of input.consents) {
        const setting = ((settings?.consentTexts ?? []) as ConsentSetting[]).find(
          (item) => item.kind === consent.kind,
        );
        if (setting === undefined) continue;
        await repo.insertConsentAcceptance(tx, {
          tenantId: site.tenantId,
          bookingSiteId: site.siteId,
          appointmentId: appointment.id,
          customerId,
          kind: consent.kind,
          // Metnin BİREBİR kopyası saklanıyor: ayarlardaki metin yarın
          // değişse bile "bu müşteriye ne gösterildi" cevaplanabilir kalıyor.
          textBody: setting.text,
          textSha256: consent.textSha256,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      await tx.execute(sql`
        insert into booking_access_tokens (tenant_id, appointment_id, token_hash, expires_at)
        values (
          ${site.tenantId}, ${appointment.id}, ${sha256(manageToken)},
          ${new Date(
            now.getTime() +
              this.config.get('BOOKING_ACCESS_TOKEN_TTL_HOURS', { infer: true }) * 3_600_000,
          ).toISOString()}::timestamptz
        )
      `);
    });

    return { appointmentId: appointment.id, manageToken };
  }

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------
  /**
   * Tutmayı token'dan çözer ve HÂLÂ GEÇERLİ olduğunu doğrular.
   *
   * `expires_at` her okumada kontrol ediliyor — kuyruğa tek dayanak olarak
   * güvenilmiyor (Faz 8 hatırlatma kalıbı). `QUEUE_ENABLED=false` iken de
   * süresi dolmuş bir tutma randevuya dönüşemez.
   */
  private async requireHold(
    tx: Tx,
    site: PublicSiteContext,
    holdToken: string,
    now: Date,
    options: { allowExpired?: boolean } = {},
  ): Promise<repo.SlotHoldRow> {
    const hold = await repo.findHoldByToken(tx, sha256(holdToken));
    // Başka bir sitenin tutması bu sitede ÇÖZÜLEMEZ.
    if (hold === undefined || hold.bookingSiteId !== site.siteId) {
      throw new AppError(404, ERROR_CODES.HOLD_INVALID, 'Seçim bulunamadı', {
        detail: 'Lütfen uygun saatleri yeniden listeleyin.',
      });
    }
    if (options.allowExpired === true) return hold;

    if (hold.status !== 'active') {
      throw new AppError(409, ERROR_CODES.HOLD_INVALID, 'Bu seçim artık geçerli değil');
    }
    if (hold.expiresAt <= now) {
      throw new AppError(409, ERROR_CODES.HOLD_EXPIRED, 'Seçim süresi doldu', {
        detail: 'Ayırdığımız saat serbest bırakıldı; lütfen yeniden seçin.',
      });
    }
    return hold;
  }

  /**
   * OTP tavanları.
   *
   * Kimlik doğrulamasız bir OTP ucu DOĞRUDAN FATURAYA YAZAN bir saldırı
   * yüzeyidir: sınırsız bırakılsa bir gecede binlerce TL SMS maliyeti
   * üretilebilir. Üç ayrı tavan var ve üçü de gerekli — telefon başına
   * (numara bombardımanı), site başına (kliniğin bütçesi) ve yeniden gönderim
   * beklemesi (aynı numaraya art arda).
   */
  private async assertOtpQuota(
    tx: Tx,
    site: PublicSiteContext,
    phone: string,
    now: Date,
  ): Promise<void> {
    const dayAgo = new Date(now.getTime() - 86_400_000);

    const perPhone = await repo.countChallengesSince(tx, { phone }, dayAgo);
    if (perPhone >= this.config.get('BOOKING_OTP_MAX_PER_PHONE_PER_DAY', { infer: true })) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Bu numaraya bugün çok fazla kod gönderildi');
    }

    const perSite = await repo.countChallengesSince(
      tx,
      { bookingSiteId: site.siteId },
      dayAgo,
    );
    if (perSite >= this.config.get('BOOKING_OTP_MAX_PER_SITE_PER_DAY', { infer: true })) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Doğrulama servisi geçici olarak meşgul');
    }

    const resendSeconds = this.config.get('BOOKING_OTP_RESEND_SECONDS', { infer: true });
    const recent = await repo.countChallengesSince(
      tx,
      { phone },
      new Date(now.getTime() - resendSeconds * 1000),
    );
    if (recent > 0) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Yeni kod için biraz bekleyin', {
        detail: `${resendSeconds} saniye içinde yeni kod gönderilemez.`,
      });
    }
  }
}

/**
 * Zorunlu onamların alındığını ve GÖSTERİLEN METNİN aynı olduğunu doğrular.
 *
 * Hash karşılaştırması kritik: yalnız "kutu işaretlendi" bilgisini saklamak,
 * yıllar sonra "hangi metin onaylandı?" sorusuna cevap veremezdi. İstemcinin
 * gördüğü metnin hash'i sunucununkiyle tutmuyorsa, arada kalmış eski bir
 * sürüm onaylanmış demektir ve bu kabul edilemez.
 */
function assertConsents(settings: ConsentSetting[], provided: ConsentAcceptanceDto[]): void {
  const required = settings.filter((setting) => setting.required !== false);

  for (const setting of required) {
    const match = provided.find((item) => item.kind === setting.kind);
    if (match === undefined) {
      throw new AppError(400, ERROR_CODES.CONSENT_REQUIRED, 'Zorunlu onay alınmadı', {
        detail: `Eksik onay: ${setting.kind}`,
      });
    }
    const expected = createHash('sha256').update(setting.text, 'utf8').digest('hex');
    if (match.textSha256 !== expected) {
      throw AppError.conflict(ERROR_CODES.CONSENT_REQUIRED, 'Onay metni güncellenmiş', {
        detail: 'Lütfen sayfayı yenileyip güncel metni onaylayın.',
      });
    }
  }
}

/**
 * Telefondan mevcut müşteriyi bulur, yoksa açar.
 *
 * Eşleme E.164 üzerinden: `customers.phone` kiracı içinde tekil ve numara
 * `normalizePhone`den geçiyor. Bu olmadan aynı müşteri her online randevuda
 * yeni bir kart olarak açılırdı — segmentin en pahalı veri hatası.
 */
async function resolveCustomer(
  tx: Tx,
  tenantId: string,
  input: { phone: string | null; fullName: string; email: string | null; gender: string | null },
): Promise<string> {
  if (input.phone !== null) {
    const existing = await tx.execute<{ id: string }>(sql`
      select id from customers
       where phone = ${input.phone} and deleted_at is null
       limit 1
    `);
    const found = existing.rows[0];
    if (found !== undefined) return found.id;
  }

  const created = await tx.execute<{ id: string }>(sql`
    insert into customers (tenant_id, full_name, phone, email, gender)
    values (
      ${tenantId}, ${input.fullName}, ${input.phone}, ${input.email},
      ${input.gender}
    )
    returning id
  `);
  const row = created.rows[0];
  if (row === undefined) throw new Error('Müşteri oluşturulamadı');
  return row.id;
}
