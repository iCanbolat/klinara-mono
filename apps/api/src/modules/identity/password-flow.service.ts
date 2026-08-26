import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { generateOpaqueToken, sha256 } from '../../common/crypto/tokens';
import { PasswordService } from '../../common/crypto/password.service';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MAIL_SENDER, type MailSender } from '../../lib/mail/mail.types';
import * as authRepo from './auth.repository';
import * as identityRepo from './identity.repository';
import * as invitationsRepo from './invitations.repository';
import { AuthService, type RequestMeta } from './auth.service';
import { PrincipalService } from './principal.service';
import type { AuthTokensDto } from './dto/auth-response.dto';

/**
 * Parola sıfırlama ve değiştirme.
 *
 * Her iki akış da aynı invariant'ı korur: parola değiştiğinde ESKİ OTURUMLARIN
 * HEPSİ DÜŞER. Parolasının çalındığını fark edip değiştiren kullanıcının,
 * saldırganın açık oturumuyla baş başa kalması kabul edilemez.
 */
@Injectable()
export class PasswordFlowService {
  private readonly ttlMinutes: number;
  private readonly appBaseUrl: string;
  private readonly exposeToken: boolean;

  constructor(
    private readonly tx: TenantTxService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly principals: PrincipalService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlMinutes = config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });
    this.appBaseUrl = config.get('APP_BASE_URL', { infer: true });
    this.exposeToken = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  /**
   * Sıfırlama isteği.
   *
   * Var olmayan e-posta için de AYNI yanıt döner. Aksi hâlde bu uç, hangi
   * e-postaların sistemde kayıtlı olduğunu söyleyen ücretsiz bir sorgu ucuna
   * dönerdi.
   */
  async forgot(rawEmail: string, meta: RequestMeta): Promise<{ token?: string }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.tx.runAsAuth((tx) => identityRepo.findUserByEmail(tx, email));

    if (user === undefined || !user.isActive) return {};

    const token = generateOpaqueToken();
    await this.tx.runAsAuth((tx) =>
      invitationsRepo.insertPasswordReset(tx, {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
        requestedIp: meta.ip,
      }),
    );

    const link = `${this.appBaseUrl}/parola-sifirla/${token}`;
    await this.mail.send({
      to: email,
      subject: 'Klinara parola sıfırlama',
      body: `Parolanızı sıfırlamak için: ${link}\nBağlantı ${this.ttlMinutes} dakika geçerlidir.`,
    });

    return this.exposeToken ? { token } : {};
  }

  /** Token ile parola belirleme — token TEK KULLANIMLIK. */
  async reset(token: string, newPassword: string): Promise<void> {
    const userId = await this.tx.runAsAuth(async (tx) => {
      const row = await invitationsRepo.findPasswordResetByHash(tx, sha256(token));
      if (row === undefined || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
        throw new AppError(400, ERROR_CODES.TOKEN_INVALID, 'Sıfırlama bağlantısı geçersiz', {
          detail: 'Bağlantının süresi dolmuş veya daha önce kullanılmış olabilir.',
        });
      }

      const consumed = await invitationsRepo.consumePasswordReset(tx, row.id);
      if (!consumed) {
        throw new AppError(400, ERROR_CODES.TOKEN_INVALID, 'Sıfırlama bağlantısı geçersiz');
      }

      await identityRepo.updateUser(tx, row.userId, {
        passwordHash: await this.passwords.hash(newPassword),
      });
      // Oturumları düşür + token sürümünü artır: elde kalan access token'lar da yanar.
      await authRepo.revokeAllSessions(tx, row.userId, 'password_reset');
      await identityRepo.bumpTokenVersion(tx, row.userId);
      return row.userId;
    });

    this.principals.invalidateUser(userId);
  }

  /**
   * Oturum içinden parola değiştirme.
   *
   * Mevcut parola sorulur (ele geçirilmiş bir oturum parolayı tek istekte
   * değiştiremesin) ve işlem sonunda TÜM oturumlar düşer; çağırana yeni bir
   * oturumun token'ları döner.
   */
  async change(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<AuthTokensDto> {
    const user = await this.tx.runAsAuth((tx) => identityRepo.findUserById(tx, userId));
    if (user === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    if (user.passwordHash === null) {
      throw new AppError(400, ERROR_CODES.CREDENTIAL_REQUIRED, 'Hesapta parola kurulu değil', {
        detail: 'Parola belirlemek için sıfırlama akışını kullanın.',
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new AppError(400, ERROR_CODES.INVALID_CREDENTIALS, 'Mevcut parola hatalı');
    }

    const tenantId = this.tx.tenantId;
    const updated = await this.tx.runAsAuth(async (tx) => {
      await identityRepo.updateUser(tx, userId, {
        passwordHash: await this.passwords.hash(newPassword),
      });
      await authRepo.revokeAllSessions(tx, userId, 'password_change');
      await identityRepo.bumpTokenVersion(tx, userId);
      return identityRepo.findUserById(tx, userId);
    });

    this.principals.invalidateUser(userId);
    if (updated === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    // Kullanıcı işlemi tamamladıktan sonra çıkmış olmasın: yeni oturum açılır.
    return this.auth.createSession({ user: updated, tenantId, method: 'password', meta });
  }
}
