import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@klinara/shared';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { AppError } from '../../common/errors/app-error';
import type { EnvironmentVariables } from '../../config/env.validation';

/**
 * Token türleri.
 *
 * `typ` claim'i ŞART: olmasaydı 2FA bekleyen bir ara token normal access token
 * gibi kullanılabilir, yani ikinci faktör tamamen atlanabilirdi. Aynı şey
 * kiracı seçimi bekleyen token için de geçerli — kiracı seçmeden veri okunurdu.
 */
export type TokenType = 'access' | 'tenant_select' | 'mfa';

const ISSUER = 'klinara';
const AUDIENCE = 'klinara-api';

export interface TokenClaims {
  /** Kullanıcı kimliği. */
  sub: string;
  /** Kiracı kimliği — `tenant_select` token'ında bulunmaz. */
  tid?: string;
  /** Oturum kimliği — yalnız `access` token'ında. */
  sid?: string;
  /** Kullanıcının token sürümü; `logout-all` ve parola değişimi bunu artırır. */
  tv: number;
  typ: TokenType;
}

export interface AccessTokenClaims extends TokenClaims {
  tid: string;
  sid: string;
  typ: 'access';
}

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;
  private readonly accessTtl: string;
  private readonly challengeTtl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.secret = new TextEncoder().encode(config.get('JWT_SECRET', { infer: true }));
    this.accessTtl = config.get('JWT_ACCESS_TTL', { infer: true });
    this.challengeTtl = config.get('JWT_CHALLENGE_TTL', { infer: true });
  }

  private sign(claims: TokenClaims, ttl: string): Promise<string> {
    const { sub, ...rest } = claims;
    return new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(this.secret);
  }

  signAccess(input: {
    userId: string;
    tenantId: string;
    sessionId: string;
    tokenVersion: number;
  }): Promise<string> {
    return this.sign(
      {
        sub: input.userId,
        tid: input.tenantId,
        sid: input.sessionId,
        tv: input.tokenVersion,
        typ: 'access',
      },
      this.accessTtl,
    );
  }

  /** Kullanıcı birden çok kiracıda: hangi kiracıya gireceği seçilene kadar. */
  signTenantSelect(input: { userId: string; tokenVersion: number }): Promise<string> {
    return this.sign(
      { sub: input.userId, tv: input.tokenVersion, typ: 'tenant_select' },
      this.challengeTtl,
    );
  }

  /** Birinci faktör geçildi, ikinci faktör bekleniyor. */
  signMfa(input: { userId: string; tenantId: string; tokenVersion: number }): Promise<string> {
    return this.sign(
      { sub: input.userId, tid: input.tenantId, tv: input.tokenVersion, typ: 'mfa' },
      this.challengeTtl,
    );
  }

  /**
   * Token'ı doğrular ve BEKLENEN türde olduğunu kontrol eder.
   *
   * Süresi dolmuş token `TOKEN_EXPIRED` ile ayrışır: istemci bunu görünce
   * sessizce `POST /auth/refresh` çağırır, kullanıcıyı giriş ekranına atmaz.
   */
  async verify<T extends TokenType>(token: string, expected: T): Promise<TokenClaims & { typ: T }> {
    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      payload = result.payload;
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new AppError(401, ERROR_CODES.TOKEN_EXPIRED, 'Oturum süresi doldu', {
          detail: 'Access token süresi doldu; yenileme token’ı ile tazeleyin.',
        });
      }
      throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Geçersiz kimlik bilgisi', {
        cause: error,
      });
    }

    if (payload['typ'] !== expected) {
      // Ara token'ı access olarak kullanma denemesi — sessizce geçirilemez.
      throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Bu token bu işlem için kullanılamaz', {
        detail: `Beklenen token türü: ${expected}`,
      });
    }

    const sub = payload['sub'];
    const tv = payload['tv'];
    if (typeof sub !== 'string' || typeof tv !== 'number') {
      throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Geçersiz kimlik bilgisi');
    }

    return {
      sub,
      tv,
      typ: expected,
      ...(typeof payload['tid'] === 'string' ? { tid: payload['tid'] } : {}),
      ...(typeof payload['sid'] === 'string' ? { sid: payload['sid'] } : {}),
    };
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    const claims = await this.verify(token, 'access');
    if (claims.tid === undefined || claims.sid === undefined) {
      throw new AppError(401, ERROR_CODES.TOKEN_INVALID, 'Geçersiz kimlik bilgisi');
    }
    return { ...claims, tid: claims.tid, sid: claims.sid };
  }
}
