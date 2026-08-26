import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { generateNumericCode, safeEqual, sha256 } from '../../common/crypto/tokens';
import { normalizePhone } from '../../common/phone';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import { SMS_SENDER, type SmsSender } from '../../lib/sms/sms.types';
import * as credentialsRepo from './credentials.repository';
import * as identityRepo from './identity.repository';

/** Saatlik SMS tavanı: hız sınırının ikinci katmanı (SMS PARALIDIR). */
const MAX_CODES_PER_HOUR = 5;

@Injectable()
export class PhoneService {
  private readonly ttlMinutes: number;
  private readonly maxAttempts: number;
  private readonly resendSeconds: number;

  constructor(
    private readonly tx: TenantTxService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly logger: PinoLogger,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlMinutes = config.get('PHONE_VERIFICATION_TTL_MINUTES', { infer: true });
    this.maxAttempts = config.get('PHONE_VERIFICATION_MAX_ATTEMPTS', { infer: true });
    this.resendSeconds = config.get('PHONE_VERIFICATION_RESEND_SECONDS', { infer: true });
  }

  /**
   * Numara ekleme akışının başı: kod üretilir ve SMS ile gönderilir.
   *
   * Numara bu aşamada kullanıcıya YAZILMAZ. Yazılsaydı, doğrulanmamış bir
   * numara profilde durur ve (tekillik indeksi doğrulanmışları kapsadığı için)
   * başkasının numarasını "rezerve etmek" mümkün olurdu.
   */
  async start(
    userId: string,
    rawPhone: string,
  ): Promise<{ phone: string; expiresAt: string; delivered: boolean }> {
    const phone = normalizePhone(rawPhone);
    if (phone === null) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Telefon numarası geçersiz', {
        extra: {
          errors: [{ path: 'phone', message: 'Geçerli bir numara girin (ör. 0532 123 45 67)' }],
        },
      });
    }

    const owner = await this.tx.runAsAuth((tx) => identityRepo.findUserByVerifiedPhone(tx, phone));
    if (owner !== undefined && owner.id !== userId) {
      // Bir numara aynı anda TEK hesapta doğrulanmış olabilir; devir için önce
      // eski hesaptan kaldırılmalıdır.
      throw AppError.conflict(ERROR_CODES.PHONE_IN_USE, 'Bu numara başka bir hesapta kayıtlı', {
        detail: 'Numarayı taşımak için önce diğer hesaptan kaldırın.',
      });
    }

    await this.assertSendAllowed(userId);

    const code = generateNumericCode(6);
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60_000);

    await this.tx.runAsAuth(async (tx) => {
      // Yeni kod istendiğinde eskiler yanar: aynı anda iki geçerli kod olmaz.
      await credentialsRepo.invalidatePhoneCodes(tx, userId);
      await credentialsRepo.insertPhoneCode(tx, {
        userId,
        phone,
        codeHash: sha256(code),
        maxAttempts: this.maxAttempts,
        expiresAt,
      });
    });

    const delivered = await this.deliver(phone, code);
    return { phone, expiresAt: expiresAt.toISOString(), delivered };
  }

  /**
   * SMS gönderimi.
   *
   * Sağlayıcı hatası isteği DÜŞÜRMEZ: kod veritabanına yazılmıştır, kullanıcı
   * yeniden gönderim isteyebilir. Netgsm'in geçici bir hatası yüzünden 500
   * dönmek, kullanıcıya "sistem bozuk" dedirtir; doğrusu durumu bildirmektir.
   */
  private async deliver(phone: string, code: string): Promise<boolean> {
    try {
      await this.sms.send({
        to: phone,
        body: `Klinara doğrulama kodunuz: ${code}. Kod ${this.ttlMinutes} dakika geçerlidir.`,
      });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'SMS gönderimi başarısız');
      return false;
    }
  }

  private async assertSendAllowed(userId: string): Promise<void> {
    const [last, recentCount] = await this.tx.runAsAuth(async (tx) => [
      await credentialsRepo.findLastPhoneCode(tx, userId),
      await credentialsRepo.countPhoneCodesSince(tx, userId, new Date(Date.now() - 3_600_000)),
    ]);

    if (last !== undefined) {
      const elapsed = (Date.now() - last.createdAt.getTime()) / 1_000;
      if (elapsed < this.resendSeconds) {
        throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Çok sık kod isteniyor', {
          detail: `Yeni kod için ${Math.ceil(this.resendSeconds - elapsed)} saniye bekleyin.`,
        });
      }
    }

    if (recentCount >= MAX_CODES_PER_HOUR) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'Saatlik kod sınırına ulaşıldı', {
        detail: 'Bir saat sonra tekrar deneyin.',
      });
    }
  }

  /**
   * Kodu doğrular ve numarayı giriş tanımlayıcısı hâline getirir.
   *
   * Deneme hakkı dolduğunda kod KOMPLE yanar: kalan hakla devam etmek, altı
   * haneli bir kodu kaba kuvvetle denemeye kapı açardı.
   */
  async verify(userId: string, code: string): Promise<{ phone: string; verifiedAt: string }> {
    const active = await this.tx.runAsAuth((tx) => credentialsRepo.findActivePhoneCode(tx, userId));

    if (active === undefined || active.expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, ERROR_CODES.VERIFICATION_FAILED, 'Doğrulama kodu geçersiz', {
        detail: 'Kodun süresi dolmuş olabilir; yeni kod isteyin.',
      });
    }

    if (!safeEqual(active.codeHash, sha256(code.trim()))) {
      const attempts = await this.tx.runAsAuth((tx) =>
        credentialsRepo.incrementPhoneCodeAttempts(tx, active.id),
      );
      if (attempts >= active.maxAttempts) {
        await this.tx.runAsAuth((tx) => credentialsRepo.invalidatePhoneCodes(tx, userId));
        throw new AppError(400, ERROR_CODES.VERIFICATION_FAILED, 'Kod çok kez yanlış girildi', {
          detail: 'Bu kod iptal edildi; yeni kod isteyin.',
        });
      }
      throw new AppError(400, ERROR_CODES.VERIFICATION_FAILED, 'Doğrulama kodu hatalı', {
        detail: `Kalan deneme hakkı: ${active.maxAttempts - attempts}`,
      });
    }

    const verifiedAt = new Date();
    try {
      await this.tx.runAsAuth(async (tx) => {
        const consumed = await credentialsRepo.consumePhoneCode(tx, active.id);
        if (!consumed) {
          throw new AppError(400, ERROR_CODES.VERIFICATION_FAILED, 'Doğrulama kodu geçersiz');
        }
        await identityRepo.updateUser(tx, userId, {
          phone: active.phone,
          phoneVerifiedAt: verifiedAt,
        });
      });
    } catch (error) {
      // Kısmi tekil indeks: aynı numarayı iki hesap AYNI ANDA doğrularsa
      // ikincisi burada düşer. Yarış koşulunda doğru davranış budur.
      if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
        throw AppError.conflict(ERROR_CODES.PHONE_IN_USE, 'Bu numara başka bir hesapta kayıtlı');
      }
      throw error;
    }

    return { phone: active.phone, verifiedAt: verifiedAt.toISOString() };
  }

  /**
   * Numarayı kaldırır.
   *
   * E-posta her hesapta zorunlu olduğu için kullanıcı giriş yeteneğini
   * kaybetmez; telefon yalnız İKİNCİ bir tanımlayıcıdır.
   */
  async remove(userId: string): Promise<void> {
    await this.tx.runAsAuth(async (tx) => {
      await credentialsRepo.invalidatePhoneCodes(tx, userId);
      await identityRepo.updateUser(tx, userId, { phone: null, phoneVerifiedAt: null });
    });
  }
}
