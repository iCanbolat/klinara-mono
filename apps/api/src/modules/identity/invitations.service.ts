import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, ROLE_BY_KEY, ROLES, isRoleKey, type RoleKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { generateOpaqueToken, sha256 } from '../../common/crypto/tokens';
import { PasswordService } from '../../common/crypto/password.service';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { setTenantContext, type Tx } from '../../database/tenant-tx';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MAIL_SENDER, type MailSender } from '../../lib/mail/mail.types';
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
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.ttlHours = config.get('INVITATION_TTL_HOURS', { infer: true });
    this.appBaseUrl = config.get('APP_BASE_URL', { infer: true });
    // Token'ı yanıtta göstermek YALNIZ üretim dışında yapılır: e-posta
    // gönderimi Batch 8.1'e kadar loga yazıyor, geliştirme akışının tıkanmaması
    // için bağlantı yanıtta da dönüyor.
    this.exposeToken = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  /**
   * Personel daveti.
   *
   * İki kural DB'ye bırakılamaz ve burada zorlanır:
   *   1. Kimse KENDİNDEN geniş yetkili bir rolü davet edemez (yetki yükseltme),
   *   2. Şube kapsamlı rol için şube zorunlu ve o şube bu kiracıya ait olmalı.
   */
  async create(input: CreateInvitationDto, principal: Principal): Promise<InvitationResponseDto> {
    const roleKey = InvitationsService.assertRole(input.roleKey);
    this.assertNoEscalation(roleKey, principal);

    const role = ROLE_BY_KEY[roleKey];
    if (role.scope === 'branch' && input.branchId === undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu rol için şube seçilmeli', {
        extra: { errors: [{ path: 'branchId', message: 'Şube kapsamlı rol için zorunlu' }] },
      });
    }
    if (role.scope === 'tenant' && input.branchId !== undefined) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bu rol şubeye bağlanamaz', {
        extra: {
          errors: [{ path: 'branchId', message: 'Kiracı kapsamlı rol için gönderilmemeli' }],
        },
      });
    }

    const email = input.email.trim().toLowerCase();
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.ttlHours * 3_600_000);

    const invitation = await this.tx
      .run(async (tx) => {
        const pending = await invitationsRepo.findPendingInvitation(tx, principal.tenantId, email);
        if (pending !== undefined) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu e-postaya bekleyen bir davet var', {
            detail: 'Önce mevcut daveti iptal edin ya da süresinin dolmasını bekleyin.',
          });
        }
        return invitationsRepo.insertInvitation(tx, {
          tenantId: principal.tenantId,
          branchId: input.branchId ?? null,
          roleKey,
          email,
          fullName: input.fullName,
          tokenHash: sha256(token),
          invitedByUserId: principal.userId,
          expiresAt,
        });
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
    await this.mail.send({
      to: email,
      subject: 'Klinara ekibine davet edildiniz',
      body: `Hesabınızı oluşturmak için: ${link}\nBağlantı ${this.ttlHours} saat geçerlidir.`,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      roleKey: invitation.roleKey,
      branchId: invitation.branchId,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
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

  /** Davet bağlantısının kullanıcıya gönderilmesi (Faz 1'de loga yazılır). */
  async sendInvitationMail(email: string, link: string, subject: string): Promise<void> {
    await this.mail.send({
      to: email,
      subject,
      body: `Hesabınızı oluşturmak için: ${link}\nBağlantı ${this.ttlHours} saat geçerlidir.`,
    });
  }

  /** Üretim dışında davet token'ı yanıtta da döner (e-posta Batch 8.1'de). */
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

      return { user, tenantId: invitation.tenantId, alreadyHadPassword: hasPassword };
    });

    this.principals.invalidateUser(outcome.user.id);

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

  private assertNoEscalation(roleKey: RoleKey, principal: Principal): void {
    const target = ROLE_BY_KEY[roleKey].rank;
    const highestOwn = Math.max(
      ...principal.roles.map((role) => (isRoleKey(role) ? ROLE_BY_KEY[role].rank : 0)),
      0,
    );
    if (target > highestOwn) {
      throw new AppError(
        403,
        ERROR_CODES.ROLE_ESCALATION,
        'Kendinizden geniş yetkili bir rol atayamazsınız',
        { detail: `Atamak istediğiniz rol: ${ROLE_BY_KEY[roleKey].name}` },
      );
    }
  }

  private static assertRole(roleKey: string): RoleKey {
    if (!isRoleKey(roleKey) || ROLE_BY_KEY[roleKey].scope === 'platform') {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Geçersiz rol', {
        extra: { errors: [{ path: 'roleKey', message: 'Tanımlı bir kiracı rolü olmalı' }] },
      });
    }
    return roleKey;
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
