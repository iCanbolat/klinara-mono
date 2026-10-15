import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, ROLE_BY_KEY, ROLES, isRoleKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { generateOpaqueToken, sha256 } from '../../common/crypto/tokens';
import { PasswordService } from '../../common/crypto/password.service';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { setTenantContext, type Tx } from '../../database/tenant-tx';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MAIL_SENDER, type MailSender } from '../../lib/mail/mail.types';
import { invitationMail } from '../../lib/mail/mail-templates';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { InvitationStaffProfile } from '../../database/schema';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import { BookingPageCacheService } from '../booking-page/booking-page-cache.service';
import * as staffRepo from '../staff/staff.repository';
import { assertCanAddPractitioner } from '../tenancy/plan-limits';
import { assertAssignableRole, assertNoEscalation, assertRoleScope } from './role-rules';
import * as identityRepo from './identity.repository';
import * as invitationsRepo from './invitations.repository';
import { AuthService, type RequestMeta } from './auth.service';
import { PrincipalService } from './principal.service';
import type { Principal } from './principal';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationPreviewDto,
  InvitationResponseDto,
} from './dto/invitation.dto';
import type { LoginResponseDto } from './dto/auth-response.dto';

@Injectable()
export class InvitationsService {
  private readonly ttlHours: number;
  private readonly appBaseUrl: string;
  private readonly exposeToken: boolean;

  constructor(
    private readonly tx: TenantTxService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly principals: PrincipalService,
    private readonly availabilityCache: AvailabilityCacheService,
    private readonly bookingPage: BookingPageCacheService,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @InjectPinoLogger(InvitationsService.name) private readonly logger: PinoLogger,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlHours = config.get('INVITATION_TTL_HOURS', { infer: true });
    this.appBaseUrl = config.get('APP_BASE_URL', { infer: true });
    // Token'ı yanıtta göstermek YALNIZ üretim dışında yapılır: yerelde e-posta
    // çoğu zaman loga yazılır, geliştirme akışı tıkanmasın diye bağlantı
    // yanıtta da döner.
    this.exposeToken = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  /**
   * Personel daveti.
   *
   * İki kural DB'ye bırakılamaz ve `role-rules.ts`te zorlanır:
   *   1. Kimse KENDİNDEN geniş yetkili bir rolü davet edemez (yetki yükseltme),
   *   2. Şube kapsamlı rol için şube zorunlu ve o şube bu kiracıya ait olmalı.
   *
   * Aynı kurallar `PUT /users/:id/memberships` ucunda da geçerli — iki atama
   * yolu tek bir modülden besleniyor.
   */
  async create(input: CreateInvitationDto, principal: Principal): Promise<InvitationResponseDto> {
    const roleKey = assertAssignableRole(input.roleKey);
    assertNoEscalation(roleKey, principal);
    assertRoleScope(roleKey, input.branchId);

    const staffProfile = InvitationsService.normalizeStaffProfile(roleKey, input);

    const email = input.email.trim().toLowerCase();
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.ttlHours * 3_600_000);

    const { invitation, tenantName, inviterName } = await this.tx
      .run(async (tx) => {
        const pending = await invitationsRepo.findPendingInvitation(tx, principal.tenantId, email);
        if (pending !== undefined) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu e-postaya bekleyen bir davet var', {
            detail: 'Önce mevcut daveti iptal edin ya da süresinin dolmasını bekleyin.',
          });
        }
        if (staffProfile !== undefined) {
          // Kabulde profil açılacak: hekim kotası dolmuşsa daveti baştan reddet,
          // kişi hesabını açtıktan sonra "profilin açılamadı" sürprizi yaşamasın.
          await assertCanAddPractitioner(tx, principal.tenantId);
          const active = await staffRepo.filterActiveServiceIds(tx, staffProfile.serviceIds);
          if (active.length !== staffProfile.serviceIds.length) {
            throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Hizmet bulunamadı', {
              detail: 'Seçilen hizmetlerden biri pasif ya da bu kliniğe ait değil.',
              extra: {
                errors: [{ path: 'staffProfile.serviceIds', message: 'Aktif bir hizmet olmalı' }],
              },
            });
          }
        }
        const row = await invitationsRepo.insertInvitation(tx, {
          tenantId: principal.tenantId,
          branchId: input.branchId ?? null,
          roleKey,
          email,
          fullName: input.fullName,
          staffProfile,
          tokenHash: sha256(token),
          invitedByUserId: principal.userId,
          expiresAt,
        });
        const [name, inviter] = await Promise.all([
          identityRepo.findTenantName(tx, principal.tenantId),
          identityRepo.findUserById(tx, principal.userId),
        ]);
        return { invitation: row, tenantName: name, inviterName: inviter?.fullName };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Şube bulunamadı');
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          // Trigger üç kuralı birden korur: rol kapsamı, şube zorunluluğu ve
          // şubenin BU kiracıya ait olması (foreign key RLS'i bypass ettiği için
          // son kural yalnız burada yakalanır).
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Rol ve şube uyumsuz', {
            detail: 'Seçilen şube bu kliniğe ait değil ya da rolün kapsamıyla uyuşmuyor.',
            cause: error,
          });
        }
        throw error;
      });

    const link = `${this.appBaseUrl}/davet/${token}`;
    const mailDelivered = await this.sendInvitationMail(email, link, {
      tenantName,
      roleName: ROLE_BY_KEY[roleKey].name,
      inviterName,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      roleKey: invitation.roleKey,
      branchId: invitation.branchId,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      mailDelivered,
      ...(this.exposeToken ? { token, link } : {}),
    };
  }

  /**
   * Kiracı kurulumunda işletme sahibi daveti.
   *
   * Kiracı oluşturma akışı platform transaction'ının İÇİNDEDİR (kiracı satırı
   * yazıldıktan sonra context o kiracıya daraltılır), bu yüzden servis kendi
   * transaction'ını açmaz; açık `tx` alır. Böylece kiracı modülü kimlik
   * modülünün repository'sine dokunmadan aynı işi yapar.
   */
  async createOwnerInvitation(
    tx: Tx,
    input: { tenantId: string; email: string; fullName?: string | undefined },
  ): Promise<{ invitation: invitationsRepo.InvitationRow; token: string; link: string }> {
    const token = generateOpaqueToken();
    const invitation = await invitationsRepo.insertInvitation(tx, {
      tenantId: input.tenantId,
      branchId: null,
      roleKey: ROLES.OWNER,
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + this.ttlHours * 3_600_000),
    });
    return { invitation, token, link: `${this.appBaseUrl}/davet/${token}` };
  }

  /**
   * Sahip davetini yeniden gönderir (platform ekranı).
   *
   * Bekleyen sahip davetleri iptal edilir ve yenisi açılır: eski bağlantı
   * e-postası kaybolmuş ya da hiç gitmemiş olabilir, ikisinin birden geçerli
   * olması gerekmiyor. E-posta verilmezse son davetin adresi kullanılır.
   */
  async reissueOwnerInvitation(
    tenantId: string,
    email?: string,
  ): Promise<{
    email: string;
    expiresAt: string;
    mailDelivered: boolean;
    token?: string;
    link?: string;
  }> {
    const result = await this.tx.runForTenant(tenantId, async (tx) => {
      const latest = await invitationsRepo.findLatestOwnerInvitation(tx, tenantId);
      const target = email?.trim().toLowerCase() ?? latest?.email;
      if (target === undefined) throw AppError.notFound('Sahip daveti bulunamadı; e-posta verin');
      await invitationsRepo.revokePendingOwnerInvitations(tx, tenantId);
      const created = await this.createOwnerInvitation(tx, {
        tenantId,
        email: target,
        fullName: latest?.email === target ? (latest.fullName ?? undefined) : undefined,
      });
      const tenantName = await identityRepo.findTenantName(tx, tenantId);
      return { ...created, tenantName };
    });

    const mailDelivered = await this.sendInvitationMail(result.invitation.email, result.link, {
      tenantName: result.tenantName,
      roleName: ROLE_BY_KEY.owner.name,
    });
    return {
      email: result.invitation.email,
      expiresAt: result.invitation.expiresAt.toISOString(),
      mailDelivered,
      ...(this.exposeToken ? { token: result.token, link: result.link } : {}),
    };
  }

  /**
   * Davet e-postasını gönderir; sonucu döndürür, HATA FIRLATMAZ.
   *
   * Davet kaydı gönderimden önce commit edilmiştir. Hata yukarı çıksaydı
   * çağıran 500 alır, aynı e-postaya tekrar davet ise "bekleyen davet var"
   * çatışmasına düşerdi. Bunun yerine `mailDelivered: false` döner; panel
   * daveti iptal edip yeniden göndermeyi (sahip için platform ekranı) önerir.
   */
  async sendInvitationMail(
    email: string,
    link: string,
    context: {
      tenantName?: string | undefined;
      roleName?: string | undefined;
      inviterName?: string | undefined;
    },
  ): Promise<boolean> {
    const { subject, body, html } = invitationMail({ link, ttlHours: this.ttlHours, ...context });
    try {
      await this.mail.send({ to: email, subject, body, html });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Davet e-postası gönderilemedi');
      return false;
    }
  }

  /** Üretim dışında davet token'ı yanıtta da döner (yerel geliştirme kolaylığı). */
  get tokenVisible(): boolean {
    return this.exposeToken;
  }

  async list(): Promise<InvitationResponseDto[]> {
    const rows = await this.tx.run((tx) => invitationsRepo.listInvitations(tx));
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      roleKey: row.roleKey,
      branchId: row.branchId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async revoke(id: string): Promise<void> {
    const revoked = await this.tx.run((tx) => invitationsRepo.revokeInvitation(tx, id));
    if (!revoked) throw AppError.notFound('Davet bulunamadı');
  }

  /**
   * Davet önizlemesi (kimlik doğrulaması YOK).
   *
   * Yalnız daveti kabul edecek kişinin göreceği kadar bilgi döner: hangi
   * klinik, hangi rol, hangi e-posta. Kiracının başka hiçbir verisi sızmaz.
   */
  async preview(token: string): Promise<InvitationPreviewDto> {
    const result = await this.tx.runAsAuth(async (tx) => {
      const invitation = await invitationsRepo.findInvitationByHash(tx, sha256(token));
      if (invitation === undefined) return undefined;
      const user = await identityRepo.findUserByEmail(tx, invitation.email);
      return { invitation, existingUser: user };
    });

    if (result === undefined) throw InvitationsService.invalidInvitation();
    const { invitation } = result;
    InvitationsService.assertUsable(invitation);

    // Kiracı adı davet ekranında gösterilir; context o kiracıya daraltılır,
    // dolayısıyla başka bir kiracının adına ulaşmak mümkün değil.
    const tenantName = await this.tx.runForTenant(invitation.tenantId, (tx) =>
      identityRepo.findTenantName(tx, invitation.tenantId),
    );

    return {
      email: invitation.email,
      fullName: invitation.fullName,
      tenantName: tenantName ?? '',
      roleKey: invitation.roleKey,
      roleName: isRoleKey(invitation.roleKey)
        ? ROLE_BY_KEY[invitation.roleKey].name
        : invitation.roleKey,
      expiresAt: invitation.expiresAt.toISOString(),
      /** Hesap zaten varsa istemci parola sormaz, girişe yönlendirir. */
      accountExists: result.existingUser?.passwordHash != null,
    };
  }

  /**
   * Daveti kabul eder.
   *
   * DİKKAT — hesap devralma koruması: e-posta ZATEN parolası kurulu bir hesaba
   * aitse parola DEĞİŞTİRİLMEZ, yalnız üyelik eklenir. Aksi hâlde birine davet
   * göndermek, o kişinin hesabının parolasını değiştirmenin yolu olurdu.
   */
  async accept(
    token: string,
    input: AcceptInvitationDto,
    meta: RequestMeta,
  ): Promise<LoginResponseDto | { status: 'membership_added' }> {
    const tokenHash = sha256(token);

    const outcome = await this.tx.runAsAuth(async (tx) => {
      const invitation = await invitationsRepo.findInvitationByHash(tx, tokenHash);
      if (invitation === undefined) throw InvitationsService.invalidInvitation();
      InvitationsService.assertUsable(invitation);

      const existing = await identityRepo.findUserByEmail(tx, invitation.email);
      const hasPassword = existing?.passwordHash != null;

      let user = existing;
      if (user === undefined) {
        if (input.password === undefined) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Parola belirlenmeli', {
            extra: { errors: [{ path: 'password', message: 'Yeni hesap için zorunlu' }] },
          });
        }
        user = await identityRepo.insertUser(tx, {
          email: invitation.email,
          fullName: input.fullName ?? invitation.fullName ?? invitation.email,
          passwordHash: await this.passwords.hash(input.password),
        });
      } else if (!hasPassword && input.password !== undefined) {
        // Davetle açılmış ama parolası hiç kurulmamış hesap: parola şimdi kurulur.
        await identityRepo.updateUser(tx, user.id, {
          passwordHash: await this.passwords.hash(input.password),
          fullName: input.fullName ?? user.fullName,
        });
        user = (await identityRepo.findUserById(tx, user.id)) ?? user;
      }

      const accepted = await invitationsRepo.acceptInvitation(tx, invitation.id, user.id);
      if (!accepted) throw InvitationsService.invalidInvitation();

      // Üyelik yazımı NORMAL kiracı politikasından geçer: context daveti
      // veren kiracıya daraltılır (bkz. kiracı oluşturma akışındaki aynı desen).
      await setTenantContext(tx, invitation.tenantId);
      await identityRepo.insertMembership(tx, {
        tenantId: invitation.tenantId,
        userId: user.id,
        branchId: invitation.branchId,
        roleKey: invitation.roleKey,
      });

      const profileOpened =
        invitation.staffProfile !== null &&
        (await InvitationsService.openStaffProfile(tx, invitation, invitation.staffProfile, user.id));

      return {
        user,
        tenantId: invitation.tenantId,
        alreadyHadPassword: hasPassword,
        profileOpened,
      };
    });

    this.principals.invalidateUser(outcome.user.id);
    if (outcome.profileOpened) {
      this.availabilityCache.invalidateTenant(outcome.tenantId);
      await this.bookingPage.invalidate('staff');
    }

    if (outcome.alreadyHadPassword) {
      // Mevcut hesaba yeni klinik eklendi; oturum açmak için normal giriş.
      return { status: 'membership_added' };
    }

    const tokens = await this.auth.createSession({
      user: outcome.user,
      tenantId: outcome.tenantId,
      method: 'invitation',
      meta,
    });
    return { status: 'authenticated', tokens, tenant: { id: outcome.tenantId } };
  }

  /**
   * Taslağı doğrular ve normalleştirir; yalnız `practitioner` rolü profil taşır.
   * Boş taslak (hiç alan yok) da profil sayılır: kişi takvimde görünsün diye
   * unvan/hizmet sonradan eklenebilir.
   */
  private static normalizeStaffProfile(
    roleKey: string,
    input: CreateInvitationDto,
  ): InvitationStaffProfile | undefined {
    const draft = input.staffProfile;
    if (draft === undefined) return undefined;
    if (roleKey !== ROLES.PRACTITIONER) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Profil yalnız uygulayıcıya açılır', {
        extra: {
          errors: [{ path: 'staffProfile', message: 'Yalnız uygulayıcı rolünde kullanılır' }],
        },
      });
    }
    const title = draft.title?.trim();
    return {
      ...(title === undefined || title === '' ? {} : { title }),
      isVisibleOnline: draft.isVisibleOnline ?? true,
      serviceIds: draft.serviceIds ?? [],
    };
  }

  /**
   * Kabul anında personel profilini açar (üyelikle AYNI transaction).
   *
   * Davet ile kabul arasında durum değişmiş olabilir; bu yüzden kabul ASLA
   * profil yüzünden başarısız olmaz (kullanıcı hesabını açmış, bağlantısı
   * tükenmiş olurdu):
   *   - profil zaten varsa dokunulmaz,
   *   - pasife alınmış hizmetler yetkinlikten düşer,
   *   - hekim kotası dolduysa profil PASİF açılır; yönetici kotayı açınca etkinleştirir.
   */
  private static async openStaffProfile(
    tx: Tx,
    invitation: invitationsRepo.InvitationRow,
    draft: InvitationStaffProfile,
    userId: string,
  ): Promise<boolean> {
    if ((await staffRepo.findStaffProfileIdByUser(tx, userId)) !== undefined) return false;

    let isActive = true;
    try {
      await assertCanAddPractitioner(tx, invitation.tenantId);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 409) throw error;
      isActive = false;
    }

    const profile = await staffRepo.insertStaffProfile(tx, {
      tenantId: invitation.tenantId,
      userId,
      primaryBranchId: invitation.branchId,
      title: draft.title,
      specialties: [],
      isVisibleOnline: draft.isVisibleOnline,
      isActive,
    });
    const serviceIds = await staffRepo.filterActiveServiceIds(tx, draft.serviceIds);
    await staffRepo.replaceStaffServices(
      tx,
      invitation.tenantId,
      profile.id,
      serviceIds.map((serviceId) => ({ serviceId })),
    );
    return true;
  }

  private static assertUsable(invitation: invitationsRepo.InvitationRow): void {
    if (
      invitation.acceptedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw InvitationsService.invalidInvitation();
    }
  }

  /** Süresi dolmuş, kullanılmış, iptal edilmiş, hiç var olmamış — hepsi aynı yanıt. */
  private static invalidInvitation(): AppError {
    return new AppError(400, ERROR_CODES.INVITATION_INVALID, 'Davet bağlantısı geçersiz', {
      detail: 'Bağlantının süresi dolmuş veya daha önce kullanılmış olabilir.',
    });
  }
}
