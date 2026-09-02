import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import type { EnvironmentVariables } from '../../config/env.validation';

export interface SlotClaim {
  tenantId: string;
  branchId: string;
  serviceIds: string[];
  /** Kaynak kimliği — dışarıya HİÇ çıkmaz, yalnız token içinde taşınır. */
  staffProfileId: string;
  startsAt: string;
  endsAt: string;
  /** Unix saniye. */
  expiresAt: number;
}

/**
 * Opak slot token'ı — public yanıtın personel UUID'si taşımamasının yolu.
 *
 * Neden şifreleme değil de İMZALI taşıma: token'ın içeriği sır değil (müşteri
 * zaten hangi saati seçtiğini biliyor); korunması gereken şey personel
 * kimliğinin DIŞARIYA ÇIKMAMASI ve token'ın kurcalanamaması. HMAC ikisini de
 * sağlıyor ve durum taşımıyor — her slot için bir veritabanı satırı açmak,
 * 30 günlük bir sorguda binlerce yazım demekti.
 *
 * ⚠️ `tenantId` payload'da ve imza kapsamında: bir kiracının token'ı başka bir
 * kiracının ucunda çözülemez. Bu kontrol imzayla değil, çözümden sonra AÇIKÇA
 * yapılıyor — imza geçse bile kiracı eşleşmezse token yok sayılır.
 *
 * İmza anahtarı `JWT_SECRET`ten TÜRETİLİYOR, doğrudan o değil: aynı anahtarla
 * imzalanmış iki farklı token türü (access token ve slot token) bir gün
 * birbirinin yerine geçmeye çalışabilirdi.
 */
@Injectable()
export class SlotTokenService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    this.key = createHmac('sha256', config.get('JWT_SECRET', { infer: true }))
      .update('klinara:slot-token:v1')
      .digest();
  }

  issue(claim: Omit<SlotClaim, 'expiresAt'>, now: Date = new Date()): string {
    const ttlMinutes = this.config.get('SLOT_TOKEN_TTL_MINUTES', { infer: true });
    const payload: SlotClaim = {
      ...claim,
      expiresAt: Math.floor(now.getTime() / 1000) + ttlMinutes * 60,
    };
    const body = base64url(JSON.stringify(payload));
    return `${body}.${this.sign(body)}`;
  }

  /**
   * Token'ı çözer ve DOĞRULAR.
   *
   * Üç kontrol de zorunlu: imza (kurcalama), kiracı (çapraz kiracı kullanımı)
   * ve süre. Herhangi biri düşerse aynı hata döner — hangisinin düştüğünü
   * söylemek, saldırgana hangi parçayı düzeltmesi gerektiğini öğretirdi.
   */
  verify(token: string, tenantId: string, now: Date = new Date()): SlotClaim {
    const [body, signature] = token.split('.');
    if (body === undefined || signature === undefined) throw invalidToken();

    const expected = this.sign(body);
    const provided = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      provided.length !== expectedBuffer.length ||
      !timingSafeEqual(provided, expectedBuffer)
    ) {
      throw invalidToken();
    }

    let claim: SlotClaim;
    try {
      claim = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SlotClaim;
    } catch {
      throw invalidToken();
    }

    if (claim.tenantId !== tenantId) throw invalidToken();
    if (claim.expiresAt * 1000 <= now.getTime()) throw invalidToken();
    return claim;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function invalidToken(): AppError {
  return new AppError(
    404,
    ERROR_CODES.SLOT_TOKEN_INVALID,
    'Seçilen saat artık geçerli değil',
    { detail: 'Lütfen uygun saatleri yeniden listeleyin.' },
  );
}
