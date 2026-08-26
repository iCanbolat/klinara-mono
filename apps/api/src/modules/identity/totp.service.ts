import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { Secret, TOTP } from 'otpauth';
import { AppError } from '../../common/errors/app-error';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { generateBackupCode, normalizeBackupCode, sha256 } from '../../common/crypto/tokens';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as credentialsRepo from './credentials.repository';
import * as identityRepo from './identity.repository';
import { AuthService, type RequestMeta } from './auth.service';
import { PrincipalService } from './principal.service';
import { TokenService } from './token.service';
import type { LoginResponseDto } from './dto/auth-response.dto';

const ISSUER = 'Klinara';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** ±1 pencere: telefonun saati birkaç saniye kaymış olabilir. */
const VALIDATION_WINDOW = 1;
const BACKUP_CODE_COUNT = 10;

@Injectable()
export class TotpService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly encryption: FieldEncryptionService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly principals: PrincipalService,
  ) {}

  private static build(secretBase32: string, label: string): TOTP {
    return new TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1',
      digits: DIGITS,
      period: PERIOD_SECONDS,
      secret: Secret.fromBase32(secretBase32),
    });
  }

  private static currentStep(): number {
    return Math.floor(Date.now() / 1_000 / PERIOD_SECONDS);
  }

  /**
   * Kurulum: yeni sır üretilir ve ŞİFRELİ saklanır, `otpauth://` URI'si döner.
   *
   * Sır bu noktada henüz ONAYLI DEĞİLDİR (`confirmed_at` null): kullanıcı
   * üretilen kodu doğrulayana kadar 2FA açık sayılmaz. Aksi hâlde QR'ı okumayı
   * beceremeyen bir kullanıcı kendi hesabından kilitlenirdi.
   */
  async setup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.tx.runAsAuth((tx) => identityRepo.findUserById(tx, userId));
    if (user === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    const existing = await this.tx.runAsAuth((tx) => credentialsRepo.findTotpSecret(tx, userId));
    if (existing?.confirmedAt != null) {
      throw AppError.conflict(ERROR_CODES.CONFLICT, 'İki adımlı doğrulama zaten açık', {
        detail: 'Yeniden kurmak için önce mevcut doğrulamayı kaldırın.',
      });
    }

    const secret = new Secret({ size: 20 });
    await this.tx.runAsAuth((tx) =>
      credentialsRepo.upsertTotpSecret(tx, {
        userId,
        secretEncrypted: this.encryption.encrypt(secret.base32),
        keyId: this.encryption.keyId,
      }),
    );

    return {
      secret: secret.base32,
      otpauthUri: TotpService.build(secret.base32, user.email).toString(),
    };
  }

  /** Kurulumu tamamlar: kod doğrulanır, yedek kodlar üretilir. */
  async enable(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const stored = await this.tx.runAsAuth((tx) => credentialsRepo.findTotpSecret(tx, userId));
    if (stored === undefined) {
      throw AppError.notFound('Önce kurulum yapılmalı');
    }
    if (stored.confirmedAt != null) {
      throw AppError.conflict(ERROR_CODES.CONFLICT, 'İki adımlı doğrulama zaten açık');
    }

    const user = await this.tx.runAsAuth((tx) => identityRepo.findUserById(tx, userId));
    if (user === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    const delta = TotpService.build(
      this.encryption.decrypt(stored.secretEncrypted),
      user.email,
    ).validate({ token: code, window: VALIDATION_WINDOW });

    if (delta === null) {
      throw new AppError(400, ERROR_CODES.MFA_INVALID, 'Doğrulama kodu hatalı');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);

    await this.tx.runAsAuth(async (tx) => {
      await credentialsRepo.confirmTotpSecret(tx, userId, TotpService.currentStep() + delta);
      await credentialsRepo.replaceBackupCodes(
        tx,
        userId,
        backupCodes.map((code) => sha256(normalizeBackupCode(code))),
      );
    });

    // Yedek kodlar SADECE burada, bir kez gösterilir.
    return { backupCodes };
  }

  /** Yeni yedek kod seti — eskiler geçersizleşir. */
  async regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
    const stored = await this.tx.runAsAuth((tx) => credentialsRepo.findTotpSecret(tx, userId));
    if (stored?.confirmedAt == null) {
      throw AppError.notFound('İki adımlı doğrulama açık değil');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    await this.tx.runAsAuth((tx) =>
      credentialsRepo.replaceBackupCodes(
        tx,
        userId,
        backupCodes.map((code) => sha256(normalizeBackupCode(code))),
      ),
    );
    return { backupCodes };
  }

  /**
   * Girişin ikinci adımı: `mfa` ara token'ı + kod → tam yetkili oturum.
   *
   * TOTP kodu ya da yedek kod kabul edilir. Hangisi kullanıldıysa oturuma
   * yazılır (`sessions.mfa_method`) — "yedek koduyla girmiş" bilgisi güvenlik
   * incelemesinde işe yarar.
   */
  async verifyChallenge(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<LoginResponseDto> {
    const claims = await this.tokens.verify(challengeToken, 'mfa');
    if (claims.tid === undefined) {
      throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Geçersiz kimlik bilgisi');
    }

    const user = await this.tx.runAsAuth((tx) => identityRepo.findUserById(tx, claims.sub));
    if (user === undefined || user.tokenVersion !== claims.tv || !user.isActive) {
      throw AppError.unauthenticated('Oturum geçerli değil');
    }

    const method = await this.consumeCode(user.id, user.email, code);
    return this.auth.completeWithMethod(user, claims.tid, 'password', meta, method);
  }

  /** Oturum açmış kullanıcının kimliğini yeniden ispatlaması (hassas işlemler). */
  async verifyForUser(userId: string, email: string, code: string): Promise<void> {
    await this.consumeCode(userId, email, code);
  }

  private async consumeCode(
    userId: string,
    email: string,
    code: string,
  ): Promise<'totp' | 'backup_code'> {
    const stored = await this.tx.runAsAuth((tx) => credentialsRepo.findTotpSecret(tx, userId));
    if (stored?.confirmedAt == null) {
      throw new AppError(400, ERROR_CODES.MFA_INVALID, 'İki adımlı doğrulama açık değil');
    }

    const trimmed = code.trim();
    const delta = TotpService.build(
      this.encryption.decrypt(stored.secretEncrypted),
      email,
    ).validate({ token: trimmed, window: VALIDATION_WINDOW });

    if (delta !== null) {
      const step = TotpService.currentStep() + delta;
      // Aynı kod 30 saniye geçerlidir; adım tüketilmezse ağı dinleyen biri
      // kodu aynı pencerede TEKRAR kullanabilirdi.
      const consumed = await this.tx.runAsAuth((tx) =>
        credentialsRepo.consumeTotpStep(tx, userId, step),
      );
      if (!consumed) {
        throw new AppError(400, ERROR_CODES.MFA_INVALID, 'Bu kod daha önce kullanıldı', {
          detail: 'Uygulamanızdaki bir sonraki kodu bekleyin.',
        });
      }
      return 'totp';
    }

    const used = await this.tx.runAsAuth((tx) =>
      credentialsRepo.consumeBackupCode(tx, userId, sha256(normalizeBackupCode(trimmed))),
    );
    if (used) return 'backup_code';

    throw new AppError(400, ERROR_CODES.MFA_INVALID, 'Doğrulama kodu hatalı');
  }

  /**
   * 2FA'yı kapatır.
   *
   * Kapatma da bir HASSAS İŞLEMDİR: geçerli bir kod istenir. Aksi hâlde ele
   * geçirilmiş bir oturum ikinci faktörü tek istekte söküp atardı.
   */
  async disable(userId: string, email: string, code: string): Promise<void> {
    await this.consumeCode(userId, email, code);
    await this.tx.runAsAuth(async (tx) => {
      await credentialsRepo.deleteTotpSecret(tx, userId);
      await credentialsRepo.replaceBackupCodes(tx, userId, []);
    });
    this.principals.invalidateUser(userId);
  }

  async status(userId: string): Promise<{ enabled: boolean; backupCodesRemaining: number }> {
    const stored = await this.tx.runAsAuth((tx) => credentialsRepo.findTotpSecret(tx, userId));
    if (stored?.confirmedAt == null) return { enabled: false, backupCodesRemaining: 0 };
    const remaining = await this.tx.runAsAuth((tx) =>
      credentialsRepo.countUnusedBackupCodes(tx, userId),
    );
    return { enabled: true, backupCodesRemaining: remaining };
  }
}
