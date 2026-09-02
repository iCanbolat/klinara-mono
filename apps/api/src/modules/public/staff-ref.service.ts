import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import type { EnvironmentVariables } from '../../config/env.validation';

/** 132 bit — klinik ölçeğinde çakışma pratik olarak imkânsız. */
const REF_LENGTH = 22;

/**
 * Personelin opak, KALICI referansı.
 *
 * Neden slot token gibi imzalı bir payload DEĞİL: `staffRef` bir URL
 * parametresi (`?staffRef=…`), bir cache anahtarı parçası ve bir yer imi.
 * Süreli ve her üretimde değişen bir token bunların üçünü de bozardı — aynı
 * personel iki istekte iki farklı değer alır, `payloadETag` her seferinde
 * değişir ve "bu uygulayıcının sayfası" diye paylaşılan bağlantı ölürdü.
 *
 * Neden düz UUID değil: public yanıtta HİÇBİR iç kimlik yok — bir testin
 * regex'i uygunluk yanıtının tamamını tarıyor. Personel UUID'si dışarı
 * çıksaydı iç uçlarda deneme yüzeyi olurdu.
 *
 * Tek yönlü olması bilinçli: çözümleme, aday kümesini (şube + hizmetlerde
 * yetkin, online görünür personel) tarayıp eşleşeni bulmakla yapılıyor. Küme
 * zaten `/staff` için hesaplanıyor ve klinik boyutuyla sınırlı; tersine
 * çevrilebilir bir şifreleme, saklamak zorunda olmadığımız bir anahtarı
 * saklamak demekti.
 *
 * `tenantId` MAC girdisinde: bir kiracının ref'i başka kiracıda çözülmez —
 * `SlotTokenService`in açık kiracı kontrolüyle aynı garanti, burada yapısal.
 */
@Injectable()
export class StaffRefService {
  private readonly key: Buffer;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.key = createHmac('sha256', config.get('JWT_SECRET', { infer: true }))
      .update('klinara:staff-ref:v1')
      .digest();
  }

  refFor(tenantId: string, staffProfileId: string): string {
    return createHmac('sha256', this.key)
      .update(`${tenantId}:${staffProfileId}`)
      .digest('base64url')
      .slice(0, REF_LENGTH);
  }

  /**
   * Ref → personel kimliği.
   *
   * Çakışma (iki adayın aynı ref'i) KAPALI DÜŞÜYOR: belirsizlikte doğru cevap
   * "birini seç" değil, "çözemedim"dir — yanlış uygulayıcıya randevu yazmak,
   * hata mesajından çok daha pahalı.
   */
  resolve(tenantId: string, ref: string, candidates: readonly string[]): string {
    const matches = candidates.filter((id) => equals(this.refFor(tenantId, id), ref));
    const [only] = matches;
    if (only === undefined || matches.length > 1) {
      throw new AppError(
        404,
        ERROR_CODES.STAFF_REF_INVALID,
        'Seçilen uygulayıcı bulunamadı',
        { detail: 'Lütfen uygulayıcı listesini yeniden yükleyin.' },
      );
    }
    return only;
  }
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
