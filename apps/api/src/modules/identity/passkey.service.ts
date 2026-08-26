import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES } from '@klinara/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AppError } from '../../common/errors/app-error';
import { normalizePhone } from '../../common/phone';
import { splitList, type EnvironmentVariables } from '../../config/env.validation';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as credentialsRepo from './credentials.repository';
import * as identityRepo from './identity.repository';
import { AuthService, type RequestMeta } from './auth.service';
import type { LoginResponseDto } from './dto/auth-response.dto';

/**
 * Passkey (WebAuthn / FIDO2).
 *
 * Sunucu YALNIZ açık anahtarı saklar; özel anahtar cihazın güvenli
 * donanımından çıkmaz. Asıl kazanç biyometri değil, OLTALAMAYA DAYANIKLILIK:
 * imza `rpId`ye bağlıdır ve sahte bir alan adı geçerli imza üretemez. Parola ve
 * TOTP'nin ikisi de bu saldırıya açıktır.
 */
@Injectable()
export class PasskeyService {
  private readonly rpId: string;
  private readonly rpName: string;
  private readonly origins: string[];
  private readonly challengeTtlMs: number;

  constructor(
    private readonly tx: TenantTxService,
    private readonly auth: AuthService,
    private readonly logger: PinoLogger,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.rpId = config.get('WEBAUTHN_RP_ID', { infer: true });
    this.rpName = config.get('WEBAUTHN_RP_NAME', { infer: true });
    this.origins = splitList(config.get('WEBAUTHN_ORIGINS', { infer: true }));
    this.challengeTtlMs = config.get('WEBAUTHN_CHALLENGE_TTL_MINUTES', { infer: true }) * 60_000;
  }

  private expiry(): Date {
    return new Date(Date.now() + this.challengeTtlMs);
  }

  // -------------------------------------------------------------------------
  // Kayıt
  // -------------------------------------------------------------------------

  /**
   * Kayıt seçenekleri. Yalnız GİRİŞ YAPMIŞ kullanıcı çağırabilir.
   *
   * Mobil akış: kullanıcı ilk kez parolayla girer, ardından cihazında passkey
   * kaydeder. Sonraki girişler tek dokunuş.
   */
  async registrationOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.tx.runAsAuth((tx) => identityRepo.findUserById(tx, userId));
    if (user === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    const existing = await this.tx.runAsAuth((tx) => credentialsRepo.listPasskeys(tx, userId));

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.fullName,
      // Attestation İSTEMİYORUZ: cihaz üreticisini kanıtlamak bizim tehdit
      // modelimizde bir şey kazandırmaz, karşılığında ek kişisel veri toplar.
      attestationType: 'none',
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: (passkey.transports ?? []) as never,
      })),
      authenticatorSelection: {
        // Discoverable credential: kullanıcı adı yazmadan giriş (mobilin asıl kazancı).
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.tx.runAsAuth((tx) =>
      credentialsRepo.insertChallenge(tx, {
        challenge: options.challenge,
        userId,
        purpose: 'registration',
        expiresAt: this.expiry(),
      }),
    );

    return options;
  }

  async register(
    userId: string,
    response: RegistrationResponseJSON,
    deviceLabel: string,
  ): Promise<{ id: string; deviceLabel: string; createdAt: string }> {
    const expectedChallenge = PasskeyService.readChallenge(response.response.clientDataJSON);
    const stored = await this.tx.runAsAuth((tx) =>
      credentialsRepo.consumeChallenge(tx, expectedChallenge, 'registration'),
    );
    if (stored === undefined || stored.userId !== userId) {
      throw new AppError(
        400,
        ERROR_CODES.PASSKEY_INVALID,
        'Kayıt isteği geçersiz veya süresi dolmuş',
      );
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpId,
        requireUserVerification: false,
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Passkey kaydı doğrulanamadı');
      throw new AppError(400, ERROR_CODES.PASSKEY_INVALID, 'Passkey doğrulanamadı', {
        cause: error,
      });
    }

    if (!verification.verified || verification.registrationInfo === undefined) {
      throw new AppError(400, ERROR_CODES.PASSKEY_INVALID, 'Passkey doğrulanamadı');
    }

    const info = verification.registrationInfo;
    const row = await this.tx.runAsAuth((tx) =>
      credentialsRepo.insertPasskey(tx, {
        userId,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        signCount: info.credential.counter,
        transports: info.credential.transports,
        aaguid: info.aaguid === '' ? undefined : info.aaguid,
        backedUp: info.credentialBackedUp,
        deviceLabel,
      }),
    );

    return {
      id: row.id,
      deviceLabel: row.deviceLabel,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Giriş
  // -------------------------------------------------------------------------

  /**
   * Giriş seçenekleri.
   *
   * Tanımlayıcı verilirse o kullanıcının credential'ları listelenir; verilmezse
   * discoverable credential akışı çalışır (kullanıcı adı bile yazmaz).
   *
   * Tanımlayıcı verildiğinde bile KULLANICI YOKSA hata dönmez: boş bir liste
   * ile normal seçenekler üretilir. Aksi hâlde bu uç, hangi e-postaların
   * kayıtlı olduğunu söyleyen bir sorgu ucuna dönerdi.
   */
  async authenticationOptions(identifier: {
    email?: string | undefined;
    phone?: string | undefined;
  }): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const user = await this.findByIdentifier(identifier);
    const credentials =
      user === undefined
        ? []
        : await this.tx.runAsAuth((tx) => credentialsRepo.listPasskeys(tx, user.id));

    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      userVerification: 'preferred',
      allowCredentials: credentials.map((passkey) => ({
        id: passkey.credentialId,
        transports: (passkey.transports ?? []) as never,
      })),
    });

    await this.tx.runAsAuth((tx) =>
      credentialsRepo.insertChallenge(tx, {
        challenge: options.challenge,
        userId: user?.id,
        purpose: 'authentication',
        expiresAt: this.expiry(),
      }),
    );

    return options;
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    meta: RequestMeta,
  ): Promise<LoginResponseDto> {
    const expectedChallenge = PasskeyService.readChallenge(response.response.clientDataJSON);
    const stored = await this.tx.runAsAuth((tx) =>
      credentialsRepo.consumeChallenge(tx, expectedChallenge, 'authentication'),
    );
    if (stored === undefined) {
      throw new AppError(
        401,
        ERROR_CODES.PASSKEY_INVALID,
        'Giriş isteği geçersiz veya süresi dolmuş',
      );
    }

    const passkey = await this.tx.runAsAuth((tx) =>
      credentialsRepo.findPasskeyByCredentialId(tx, response.id),
    );
    if (passkey === undefined) {
      throw new AppError(401, ERROR_CODES.PASSKEY_INVALID, 'Bu cihaz tanınmıyor');
    }
    // Challenge belli bir kullanıcı için üretildiyse imzanın o kullanıcıdan
    // gelmesi gerekir: başkasının credential'ıyla giriş denemesi burada düşer.
    if (stored.userId !== null && stored.userId !== passkey.userId) {
      throw new AppError(401, ERROR_CODES.PASSKEY_INVALID, 'Bu cihaz tanınmıyor');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpId,
        requireUserVerification: false,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.signCount,
          transports: (passkey.transports ?? []) as never,
        },
      });
    } catch (error) {
      // Sayaç gerilemesi de buraya düşer (klonlanmış authenticator).
      this.logger.warn({ err: error, passkeyId: passkey.id }, 'Passkey doğrulaması reddedildi');
      throw new AppError(401, ERROR_CODES.PASSKEY_INVALID, 'Passkey doğrulanamadı', {
        cause: error,
      });
    }

    if (!verification.verified) {
      throw new AppError(401, ERROR_CODES.PASSKEY_INVALID, 'Passkey doğrulanamadı');
    }

    const newCounter = verification.authenticationInfo.newCounter;
    // Sayacı destekleyen authenticator'larda gerileme = klonlanmış cihaz.
    if (passkey.signCount > 0 && newCounter <= passkey.signCount) {
      throw new AppError(401, ERROR_CODES.PASSKEY_INVALID, 'Cihaz doğrulaması reddedildi', {
        detail: 'Güvenlik sayacı geriledi; bu cihaz klonlanmış olabilir.',
      });
    }

    const user = await this.tx.runAsAuth(async (tx) => {
      await credentialsRepo.updatePasskeyUsage(tx, passkey.id, newCounter);
      return identityRepo.findUserById(tx, passkey.userId);
    });

    if (user === undefined || !user.isActive) {
      throw new AppError(401, ERROR_CODES.PASSKEY_INVALID, 'Hesap kullanılamıyor');
    }

    // Passkey TEK ADIMDA iki faktördür (cihaza sahip olmak + biyometri);
    // bu yüzden ayrıca TOTP istenmez.
    return this.auth.completeAfterPasskey(user, meta);
  }

  // -------------------------------------------------------------------------
  // Yönetim
  // -------------------------------------------------------------------------

  async list(userId: string) {
    const rows = await this.tx.runAsAuth((tx) => credentialsRepo.listPasskeys(tx, userId));
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      backedUp: row.backedUp,
      transports: row.transports ?? [],
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async rename(userId: string, id: string, deviceLabel: string) {
    const row = await this.tx.runAsAuth((tx) =>
      credentialsRepo.renamePasskey(tx, id, userId, deviceLabel),
    );
    if (row === undefined) throw AppError.notFound('Passkey bulunamadı');
    return {
      id: row.id,
      deviceLabel: row.deviceLabel,
      backedUp: row.backedUp,
      transports: row.transports ?? [],
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Passkey siler.
   *
   * SON passkey silinirken parolanın kurulu olduğu doğrulanır. Yalnız passkey
   * ile giriş yapan bir kullanıcı son cihazını sildiğinde hesabından kalıcı
   * olarak kilitlenirdi — bu, kurtarılamayan tek hata sınıfıdır.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.tx.runAsAuth(async (tx) => {
      const passkey = await credentialsRepo.findPasskeyById(tx, id, userId);
      if (passkey === undefined) throw AppError.notFound('Passkey bulunamadı');

      const all = await credentialsRepo.listPasskeys(tx, userId);
      if (all.length === 1) {
        const user = await identityRepo.findUserById(tx, userId);
        if (user?.passwordHash == null) {
          throw new AppError(409, ERROR_CODES.CREDENTIAL_REQUIRED, 'Son passkey silinemez', {
            detail:
              'Hesabınızda parola kurulu değil; bu passkey silinirse giriş yapamazsınız. Önce bir parola belirleyin.',
          });
        }
      }

      await credentialsRepo.deletePasskey(tx, id, userId);
    });
  }

  private async findByIdentifier(identifier: {
    email?: string | undefined;
    phone?: string | undefined;
  }): Promise<identityRepo.UserRow | undefined> {
    if (identifier.email !== undefined && identifier.email !== '') {
      return this.tx.runAsAuth((tx) =>
        identityRepo.findUserByEmail(tx, identifier.email!.trim().toLowerCase()),
      );
    }
    if (identifier.phone !== undefined && identifier.phone !== '') {
      const phone = normalizePhone(identifier.phone);
      if (phone === null) return undefined;
      return this.tx.runAsAuth((tx) => identityRepo.findUserByVerifiedPhone(tx, phone));
    }
    return undefined;
  }

  /**
   * `clientDataJSON` içindeki challenge'ı okur.
   *
   * Challenge'ı istemcinin gövdede AYRICA göndermesini beklemiyoruz: doğrulama
   * kütüphanesi zaten `clientDataJSON`dakini karşılaştırıyor, biz de veritabanı
   * kaydını aynı değerle arıyoruz. Böylece istemcinin gönderdiği ikinci bir
   * alanla oynayarak başka bir challenge kaydını tüketmesi mümkün olmuyor.
   */
  private static readChallenge(clientDataJSON: string): string {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
      const challenge = (parsed as { challenge?: unknown }).challenge;
      if (typeof challenge !== 'string' || challenge.length === 0) {
        throw new Error('challenge yok');
      }
      return challenge;
    } catch (error) {
      throw new AppError(400, ERROR_CODES.PASSKEY_INVALID, 'İstek gövdesi çözümlenemedi', {
        cause: error,
      });
    }
  }
}
