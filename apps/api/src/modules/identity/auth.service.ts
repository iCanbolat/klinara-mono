import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { durationFromNow, durationToSeconds } from '../../common/duration';
import { normalizePhone } from '../../common/phone';
import { generateOpaqueToken, sha256 } from '../../common/crypto/tokens';
import { PasswordService } from '../../common/crypto/password.service';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { EnvironmentVariables } from '../../config/env.validation';
import * as authRepo from './auth.repository';
import * as identityRepo from './identity.repository';
import { PrincipalService } from './principal.service';
import { TokenService } from './token.service';
import { MfaPolicyService } from './mfa-policy.service';
import type { LoginDto } from './dto/auth.dto';
import type { AuthTokensDto, LoginResponseDto, TenantOptionDto } from './dto/auth-response.dto';

/** Girişi yapan istemcinin izi — oturum listesinde ve denetimde görünür. */
export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceLabel?: string | undefined;
}

type AuthMethod = authRepo.SessionRow['authMethod'];
type MfaMethod = NonNullable<authRepo.SessionRow['mfaMethod']>;

@Injectable()
export class AuthService {
  private readonly refreshTtl: string;
  private readonly accessTtlSeconds: number;
  private readonly maxAttempts: number;
  private readonly attemptWindowMinutes: number;

  constructor(
    private readonly tx: TenantTxService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly principals: PrincipalService,
    private readonly mfaPolicy: MfaPolicyService,
    private readonly logger: PinoLogger,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.refreshTtl = config.get('JWT_REFRESH_TTL', { infer: true });
    this.accessTtlSeconds = durationToSeconds(config.get('JWT_ACCESS_TTL', { infer: true }));
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.attemptWindowMinutes = config.get('LOGIN_ATTEMPT_WINDOW_MINUTES', { infer: true });
  }

  // -------------------------------------------------------------------------
  // Giriş
  // -------------------------------------------------------------------------

  /**
   * E-posta VEYA telefon ile giriş.
   *
   * Tanımlayıcı ile faktör dik eksenlerdir: sunucu için "hangi tanımlayıcı
   * geldi" bir ayrıntıdır, akış TEKTİR. İki ayrı akış yazmak, er ya da geç
   * yalnız birine eklenen bir güvenlik kontrolü demektir.
   */
  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResponseDto> {
    const identifier = this.resolveIdentifier(dto);
    await this.assertNotLocked(identifier);

    const user = await this.tx.runAsAuth((tx) =>
      identifier.kind === 'email'
        ? identityRepo.findUserByEmail(tx, identifier.value)
        : identityRepo.findUserByVerifiedPhone(tx, identifier.value),
    );

    // Kullanıcı yok ya da parolası kurulu değil (davet bekliyor): yanıt da,
    // HARCANAN SÜRE de doğru paroladakiyle aynı olmalı. Aksi hâlde yanıt süresi
    // "bu e-posta kayıtlı mı?" sorusunu cevaplar.
    if (user === undefined || user.passwordHash === null) {
      await this.passwords.fakeVerify();
      await this.recordFailure(identifier.value, undefined, 'unknown_user', meta);
      throw AuthService.invalidCredentials();
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.recordFailure(identifier.value, user.id, 'bad_password', meta);
      throw AuthService.invalidCredentials();
    }

    if (!user.isActive) {
      await this.recordFailure(identifier.value, user.id, 'inactive', meta);
      throw new AppError(403, ERROR_CODES.ACCOUNT_DISABLED, 'Hesap devre dışı', {
        detail: 'Klinik yöneticinizle iletişime geçin.',
      });
    }

    await this.recordSuccess(identifier.value, user.id, meta);
    return this.continueAfterPrimaryFactor(user, 'password', meta);
  }

  /**
   * Birinci faktör geçildikten sonraki ortak yol.
   *
   * Parola ve passkey akışları BURADA birleşir: kiracı seçimi, 2FA kontrolü ve
   * oturum açma tek yerde yapılır. Passkey ile girişte ikinci faktör istenmez —
   * cihaza sahip olmak + biyometri zaten iki faktördür.
   */
  private async continueAfterPrimaryFactor(
    user: identityRepo.UserRow,
    method: AuthMethod,
    meta: RequestMeta,
    options: { mfaSatisfiedBy?: MfaMethod } = {},
  ): Promise<LoginResponseDto> {
    const memberships = await this.tx.runAsAuth(
      (tx) => identityRepo.listMembershipsForUser(tx, user.id),
      { actorUserId: user.id },
    );

    if (memberships.length === 0) {
      throw AppError.forbidden('Hiçbir klinikte yetkiniz yok', {
        detail: 'Hesabınız bir kliniğe bağlı değil. Klinik yöneticinizden davet isteyin.',
      });
    }

    const tenants = AuthService.toTenantOptions(memberships);

    if (tenants.length > 1) {
      // Ara token: kiracı seçilene kadar hiçbir veriye erişim vermez.
      return {
        status: 'tenant_selection_required',
        challengeToken: await this.tokens.signTenantSelect({
          userId: user.id,
          tokenVersion: user.tokenVersion,
        }),
        tenants,
      };
    }

    const tenant = tenants[0];
    if (tenant === undefined) throw AppError.forbidden('Hiçbir klinikte yetkiniz yok');

    return this.issueOrChallenge(user, tenant.id, method, meta, options);
  }

  /** Kiracı belli: ya 2FA ara token'ı ya da tam yetkili oturum. */
  private async issueOrChallenge(
    user: identityRepo.UserRow,
    tenantId: string,
    method: AuthMethod,
    meta: RequestMeta,
    options: { mfaSatisfiedBy?: MfaMethod } = {},
  ): Promise<LoginResponseDto> {
    if (options.mfaSatisfiedBy === undefined && method !== 'passkey') {
      const requirement = await this.mfaPolicy.evaluate(user.id, tenantId);
      if (requirement.required) {
        return {
          status: 'mfa_required',
          challengeToken: await this.tokens.signMfa({
            userId: user.id,
            tenantId,
            tokenVersion: user.tokenVersion,
          }),
          mfa: { configured: requirement.configured, methods: requirement.methods },
        };
      }
    }

    const tokens = await this.createSession({
      user,
      tenantId,
      method,
      meta,
      ...(options.mfaSatisfiedBy !== undefined ? { mfaMethod: options.mfaSatisfiedBy } : {}),
    });

    return { status: 'authenticated', tokens, tenant: { id: tenantId } };
  }

  /** Kiracı seçimi: `tenant_select` ara token'ı ile. */
  async selectTenant(
    challengeToken: string,
    tenantId: string,
    meta: RequestMeta,
  ): Promise<LoginResponseDto> {
    const claims = await this.tokens.verify(challengeToken, 'tenant_select');

    const result = await this.tx.runAsAuth(
      async (tx) => {
        const user = await identityRepo.findUserById(tx, claims.sub);
        if (user === undefined) return undefined;
        const memberships = await identityRepo.listMembershipsForUser(tx, user.id);
        return { user, memberships };
      },
      { actorUserId: claims.sub },
    );

    if (result === undefined || result.user.tokenVersion !== claims.tv) {
      throw AppError.unauthenticated('Oturum geçerli değil');
    }
    if (!result.memberships.some((membership) => membership.tenantId === tenantId)) {
      // Var olmayan kiracı ile üyeliği olmayan kiracı aynı yanıtı verir:
      // kullanıcı, üyesi olmadığı bir kiracının varlığını öğrenemez.
      throw AppError.forbidden('Bu klinikte yetkiniz yok');
    }

    return this.issueOrChallenge(result.user, tenantId, 'password', meta);
  }

  // -------------------------------------------------------------------------
  // Oturum ve token'lar
  // -------------------------------------------------------------------------

  /** Passkey ve 2FA akışlarının da kullandığı ortak oturum açma. */
  async createSession(input: {
    user: identityRepo.UserRow;
    tenantId: string;
    method: AuthMethod;
    meta: RequestMeta;
    mfaMethod?: MfaMethod;
  }): Promise<AuthTokensDto> {
    const expiresAt = durationFromNow(this.refreshTtl);

    const { session, refreshToken } = await this.tx.runAsAuth(async (tx) => {
      const created = await authRepo.insertSession(tx, {
        userId: input.user.id,
        tenantId: input.tenantId,
        authMethod: input.method,
        ...(input.mfaMethod !== undefined ? { mfaMethod: input.mfaMethod } : {}),
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
        deviceLabel: input.meta.deviceLabel,
        expiresAt,
      });
      const token = await this.issueRefreshToken(tx, created.id, expiresAt);
      await identityRepo.updateUser(tx, input.user.id, { lastLoginAt: new Date() });
      return { session: created, refreshToken: token };
    });

    const accessToken = await this.tokens.signAccess({
      userId: input.user.id,
      tenantId: input.tenantId,
      sessionId: session.id,
      tokenVersion: input.user.tokenVersion,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }

  private async issueRefreshToken(
    tx: Tx,
    sessionId: string,
    expiresAt: Date,
    parentId?: string,
  ): Promise<string> {
    const token = generateOpaqueToken();
    await authRepo.insertRefreshToken(tx, {
      sessionId,
      // Veritabanına yalnız ÖZET yazılır; düz metin token bu fonksiyondan
      // sonra hiçbir yerde durmaz.
      tokenHash: sha256(token),
      expiresAt,
      parentId,
    });
    return token;
  }

  /**
   * Refresh rotation + yeniden kullanım (reuse) tespiti.
   *
   * Her yenileme yeni bir token üretir ve eskisini yakar. Yanmış bir token
   * TEKRAR gelirse iki ihtimal vardır: ya token çalınmıştır ya da meşru istemci
   * ile saldırgan aynı token'ı kullanıyordur. İkisini ayırt etmek mümkün
   * olmadığı için oturum AİLESİNİN TAMAMI iptal edilir — güvenli taraf budur.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokensDto> {
    const tokenHash = sha256(refreshToken);

    const outcome = await this.tx.runAsAuth(async (tx) => {
      const stored = await authRepo.findRefreshTokenByHash(tx, tokenHash);
      if (stored === undefined) return { kind: 'invalid' as const };

      const session = await authRepo.findSession(tx, stored.sessionId);
      if (session === undefined) return { kind: 'invalid' as const };

      if (stored.usedAt !== null) {
        await authRepo.revokeSession(tx, session.id, 'refresh_token_reuse');
        return { kind: 'reuse' as const, session };
      }
      if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
        return { kind: 'invalid' as const };
      }
      if (stored.expiresAt.getTime() <= Date.now()) {
        return { kind: 'invalid' as const };
      }

      // Koşullu update: aynı token'la gelen iki eş zamanlı istekte yalnız biri
      // kazanır, diğeri yeniden kullanım muamelesi görür.
      const claimed = await authRepo.markRefreshTokenUsed(tx, stored.id);
      if (!claimed) {
        await authRepo.revokeSession(tx, session.id, 'refresh_token_reuse');
        return { kind: 'reuse' as const, session };
      }

      const user = await identityRepo.findUserById(tx, session.userId);
      if (user === undefined || !user.isActive) return { kind: 'invalid' as const };

      const next = await this.issueRefreshToken(tx, session.id, session.expiresAt, stored.id);
      await authRepo.touchSession(tx, session.id);
      return { kind: 'rotated' as const, session, user, refreshToken: next };
    });

    if (outcome.kind === 'reuse') {
      this.principals.invalidateSession(outcome.session.id);
      this.logger.warn(
        { sessionId: outcome.session.id, userId: outcome.session.userId, ip: meta.ip },
        'Yenileme token’ı yeniden kullanıldı — oturum ailesi iptal edildi',
      );
      throw new AppError(
        401,
        ERROR_CODES.TOKEN_INVALID,
        'Oturum güvenlik nedeniyle sonlandırıldı',
        {
          detail:
            'Yenileme token’ı ikinci kez kullanıldı; tüm oturum iptal edildi. Yeniden giriş yapın.',
        },
      );
    }
    if (outcome.kind === 'invalid') {
      throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Yenileme token’ı geçersiz');
    }

    const accessToken = await this.tokens.signAccess({
      userId: outcome.user.id,
      tenantId: outcome.session.tenantId,
      sessionId: outcome.session.id,
      tokenVersion: outcome.user.tokenVersion,
    });

    return {
      accessToken,
      refreshToken: outcome.refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }

  /** Tek oturumu kapatır (bu cihaz). */
  async logout(sessionId: string): Promise<void> {
    await this.tx.runAsAuth((tx) => authRepo.revokeSession(tx, sessionId, 'logout'));
    this.principals.invalidateSession(sessionId);
  }

  /**
   * Tüm oturumları kapatır.
   *
   * Oturumları iptal etmek TEK BAŞINA yetmez: access token stateless'tır ve 15
   * dakika daha imza doğrulamasından geçer. `token_version` artırılarak elde
   * kalan tüm access token'lar da geçersizleşir.
   */
  async logoutAll(userId: string): Promise<{ revokedSessions: number }> {
    const revoked = await this.tx.runAsAuth(async (tx) => {
      const count = await authRepo.revokeAllSessions(tx, userId, 'logout_all');
      await identityRepo.bumpTokenVersion(tx, userId);
      return count;
    });
    this.principals.invalidateUser(userId);
    return { revokedSessions: revoked };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await this.tx.runAsAuth((tx) => authRepo.listActiveSessions(tx, userId));
    return rows.map((row) => ({
      id: row.id,
      current: row.id === currentSessionId,
      authMethod: row.authMethod,
      mfaMethod: row.mfaMethod,
      deviceLabel: row.deviceLabel,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.tx.runAsAuth(async (tx) => {
      const session = await authRepo.findSession(tx, sessionId);
      // RLS zaten başka kullanıcının oturumunu göstermez; yine de açıkça
      // kontrol ediyoruz — savunma katmanları birbirinin yerine geçmez.
      if (session === undefined || session.userId !== userId) return 0;
      return authRepo.revokeSession(tx, sessionId, 'revoked_by_user');
    });
    if (revoked === 0) throw AppError.notFound('Oturum bulunamadı');
    this.principals.invalidateSession(sessionId);
  }

  // -------------------------------------------------------------------------
  // Hız sınırı ve denetim
  // -------------------------------------------------------------------------

  private resolveIdentifier(dto: LoginDto): { kind: 'email' | 'phone'; value: string } {
    const hasEmail = dto.email !== undefined && dto.email !== '';
    const hasPhone = dto.phone !== undefined && dto.phone !== '';

    if (hasEmail === hasPhone) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'E-posta veya telefondan tam olarak biri gönderilmeli',
        { extra: { errors: [{ path: 'email', message: 'email veya phone; ikisi birden değil' }] } },
      );
    }

    if (hasEmail) return { kind: 'email', value: dto.email!.trim().toLowerCase() };

    const normalized = normalizePhone(dto.phone!);
    if (normalized === null) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Telefon numarası geçersiz', {
        extra: {
          errors: [{ path: 'phone', message: 'E.164 biçiminde geçerli bir numara olmalı' }],
        },
      });
    }
    return { kind: 'phone', value: normalized };
  }

  /**
   * Kademeli kilit.
   *
   * Sayaç TANIMLAYICIYA bağlıdır, kullanıcıya değil: var olmayan bir e-posta
   * ile yapılan denemeler de sayılır. Böylece kilit yanıtı "bu hesap var"
   * bilgisini sızdırmaz.
   */
  private async assertNotLocked(identifier: { value: string }): Promise<void> {
    const since = new Date(Date.now() - this.attemptWindowMinutes * 60_000);
    const failures = await this.tx.runAsAuth((tx) =>
      authRepo.countRecentFailures(tx, identifier.value, since),
    );
    if (failures >= this.maxAttempts) {
      throw new AppError(429, ERROR_CODES.ACCOUNT_LOCKED, 'Çok fazla hatalı deneme', {
        detail: `Güvenlik nedeniyle giriş geçici olarak kapatıldı. ${this.attemptWindowMinutes} dakika sonra tekrar deneyin.`,
      });
    }
  }

  private async recordFailure(
    identifier: string,
    userId: string | undefined,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tx.runAsAuth((tx) =>
      authRepo.recordLoginAttempt(tx, {
        identifier,
        userId,
        succeeded: false,
        reason,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }

  private async recordSuccess(
    identifier: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.tx.runAsAuth(async (tx) => {
      await authRepo.recordLoginAttempt(tx, {
        identifier,
        userId,
        succeeded: true,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // Kilit ARDIŞIK hatalara bakar: başarılı giriş sayacı sıfırlar.
      await authRepo.clearFailures(tx, identifier);
    });
  }

  /**
   * Kullanıcı yok, parola yanlış, hesap davet bekliyor — HEPSİ aynı yanıt.
   * Ayrıştırmak, kullanıcı sayımına (account enumeration) açık kapı bırakır.
   */
  private static invalidCredentials(): AppError {
    return new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, 'E-posta veya parola hatalı', {
      detail: 'Bilgilerinizi kontrol edip tekrar deneyin.',
    });
  }

  private static toTenantOptions(memberships: identityRepo.MembershipSummary[]): TenantOptionDto[] {
    const byTenant = new Map<string, TenantOptionDto>();
    for (const membership of memberships) {
      const existing = byTenant.get(membership.tenantId);
      if (existing === undefined) {
        byTenant.set(membership.tenantId, {
          id: membership.tenantId,
          slug: membership.tenantSlug,
          name: membership.tenantName,
          roles: [membership.roleKey],
        });
      } else if (!existing.roles.includes(membership.roleKey)) {
        existing.roles.push(membership.roleKey);
      }
    }
    return [...byTenant.values()];
  }

  /** Passkey ve 2FA akışlarının ortak yola girmesi için. */
  async completeWithMethod(
    user: identityRepo.UserRow,
    tenantId: string,
    method: AuthMethod,
    meta: RequestMeta,
    mfaMethod?: MfaMethod,
  ): Promise<LoginResponseDto> {
    return this.issueOrChallenge(user, tenantId, method, meta, {
      ...(mfaMethod !== undefined ? { mfaSatisfiedBy: mfaMethod } : {}),
    });
  }

  /** Passkey girişinde kiracı seçimi de gerekebilir. */
  async completeAfterPasskey(
    user: identityRepo.UserRow,
    meta: RequestMeta,
  ): Promise<LoginResponseDto> {
    return this.continueAfterPrimaryFactor(user, 'passkey', meta);
  }
}
