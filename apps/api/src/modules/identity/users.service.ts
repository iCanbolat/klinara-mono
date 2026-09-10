import { Injectable } from '@nestjs/common';
import { ERROR_CODES, ROLES, ROLE_BY_KEY, isRoleKey, type RoleKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import { BranchAccessService } from '../tenancy/branch-access.service';
import type { Principal } from './principal';
import { PrincipalService } from './principal.service';
import * as identityRepo from './identity.repository';
import { assertAssignableRole, assertNoEscalation, assertRoleScope } from './role-rules';
import type {
  MeResponseDto,
  MembershipResponseDto,
  PutMembershipsDto,
  UpdateUserDto,
  UserResponseDto,
} from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly principals: PrincipalService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * `/me` — istemcinin arayüzü buna göre kurulur.
   *
   * İzinler burada da açıkça döner: istemci hangi menüyü göstereceğine bakarak
   * karar verir. Bu bir GÜVENLİK kontrolü değildir (o sunucuda) ama arayüzün
   * kullanıcıya yapamayacağı işi göstermemesini sağlar.
   */
  async me(principal: Principal): Promise<MeResponseDto> {
    const user = await this.tx.run((tx) => identityRepo.findUserById(tx, principal.userId));
    if (user === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    return {
      user: UsersService.toResponse(user),
      tenantId: principal.tenantId,
      roles: principal.roles,
      permissions: [...principal.permissions].sort(),
      branchIds: principal.branchIds,
      tenantWide: principal.tenantWide,
    };
  }

  async updateMe(principal: Principal, input: UpdateUserDto): Promise<UserResponseDto> {
    const row = await this.tx.run((tx) =>
      identityRepo.updateUser(tx, principal.userId, {
        fullName: input.fullName,
        locale: input.locale,
      }),
    );
    if (row === undefined) throw AppError.notFound('Kullanıcı bulunamadı');
    this.principals.invalidateUser(principal.userId);
    return UsersService.toResponse(row);
  }

  /** Kiracının personeli. RLS zaten başka kiracının kullanıcısını göstermez. */
  async list(): Promise<UserResponseDto[]> {
    const rows = await this.tx.run((tx) => identityRepo.listTenantUsers(tx));
    return rows.map((row) => UsersService.toResponse(row));
  }

  async get(id: string, tenantId: string): Promise<UserResponseDto> {
    const result = await this.tx.run(async (tx) => {
      const user = await identityRepo.findUserById(tx, id);
      if (user === undefined) return undefined;
      const memberships = await identityRepo.listMembershipsInTenant(tx, id, tenantId);
      return { user, memberships };
    });

    if (result === undefined || result.memberships.length === 0) {
      // Başka kiracının kullanıcısı da "bulunamadı"dır: varlığı sızmaz.
      throw AppError.notFound('Kullanıcı bulunamadı');
    }

    return UsersService.toResponse(result.user, result.memberships);
  }

  async update(id: string, tenantId: string, input: UpdateUserDto): Promise<UserResponseDto> {
    // Önce kiracıda görünürlüğünü doğrula: aksi hâlde PATCH, kiracı dışındaki
    // bir kullanıcıyı güncelleyebilirdi (RLS users politikası üyeliğe bakar
    // ama savunmayı tek katmana bırakmıyoruz).
    await this.get(id, tenantId);

    const row = await this.tx.run((tx) =>
      identityRepo.updateUser(tx, id, {
        fullName: input.fullName,
        locale: input.locale,
        isActive: input.isActive,
      }),
    );
    if (row === undefined) throw AppError.notFound('Kullanıcı bulunamadı');

    // Rol/erişim etkileyen değişiklik: cache'i düşür ki sonraki istek güncel olsun.
    this.principals.invalidateUser(id);
    return UsersService.toResponse(row);
  }

  // ---------------------------------------------------------------------------
  // Üyelik (rol) yönetimi
  // ---------------------------------------------------------------------------

  async listMemberships(id: string, tenantId: string): Promise<MembershipResponseDto[]> {
    // `get` görünürlüğü zaten doğruluyor: kiracıda üyeliği olmayan kullanıcı
    // 404'tür ve varlığı sızmaz.
    const user = await this.get(id, tenantId);
    return user.memberships;
  }

  /**
   * Rol değiştirme — Faz 1'den devreden açık maddenin kapanışı.
   *
   * Faz 1'de rol YALNIZ davetle atanıyordu; bir personelin rolünü değiştirmenin
   * tek yolu hesabı pasife alıp yeniden davet etmekti. Bu uç, aynı yetki
   * yükseltme kurallarını (`role-rules.ts`) paylaşarak ikinci atama yolunu
   * açıyor.
   *
   * Davetten FARKLI olarak burada üç ek kural var — üçü de yalnız MEVCUT bir
   * üyeliğe dokunurken anlamlı:
   *
   *   1. **Kendi üyeliğine dokunulamaz.** Kendi rolünü düşürmek geri alınamaz
   *      bir kilitlenme (artık `user:write` iznin yok), yükseltmek zaten
   *      yasak. Başkasının değiştirmesi gereken bir şey.
   *   2. **KALDIRILAN rol de rank kontrolünden geçer.** Yalnız verilen rolü
   *      denetlemek, şube yöneticisine işletme sahibinin üyeliğini silme
   *      yetkisi verirdi: yetki yükseltmenin aynı sonuca varan tersi.
   *   3. **Son işletme sahibi kaldırılamaz.** Sahipsiz kalan bir kiracıyı
   *      yalnız platform kurtarabilirdi.
   */
  async replaceMemberships(
    principal: Principal,
    id: string,
    input: PutMembershipsDto,
  ): Promise<MembershipResponseDto[]> {
    if (id === principal.userId) {
      throw AppError.forbidden('Kendi rollerinizi değiştiremezsiniz', {
        detail: 'Rol değişimini sizden en az bir seviye yetkili bir kullanıcı yapmalı.',
      });
    }

    const desired = input.memberships.map((entry) => {
      const roleKey = assertAssignableRole(entry.roleKey);
      assertNoEscalation(roleKey, principal);
      assertRoleScope(roleKey, entry.branchId);
      return { roleKey, branchId: entry.branchId ?? null };
    });

    UsersService.assertDistinct(desired);

    // Şube kimlikleri İSTEMCİDEN geliyor: üyelik VE kiracıya aidiyet aranır.
    for (const branchId of new Set(desired.flatMap((e) => (e.branchId === null ? [] : [e.branchId])))) {
      await this.branchAccess.assertInput(principal, branchId);
    }

    // Görünürlük kontrolü: başka kiracının kullanıcısı 404'tür.
    await this.get(id, principal.tenantId);

    const rows = await this.tx
      .run(async (tx) => {
        const current = await identityRepo.listMembershipsInTenant(tx, id, principal.tenantId);

        const keyOf = (m: { roleKey: string; branchId: string | null }): string =>
          `${m.roleKey}:${m.branchId ?? ''}`;
        const desiredKeys = new Set(desired.map(keyOf));
        const currentKeys = new Set(current.map(keyOf));

        const removed = current.filter((row) => !desiredKeys.has(keyOf(row)));
        for (const row of removed) {
          assertNoEscalation(assertAssignableRole(row.roleKey), principal);
        }

        await this.assertOwnerSurvives(tx, principal.tenantId, id, removed, desiredKeys);

        for (const row of removed) {
          await identityRepo.deactivateMembership(tx, row.id);
        }
        for (const entry of desired) {
          if (currentKeys.has(keyOf(entry))) continue;
          await identityRepo.insertMembership(tx, {
            tenantId: principal.tenantId,
            userId: id,
            branchId: entry.branchId,
            roleKey: entry.roleKey,
          });
        }

        return identityRepo.listMembershipsInTenant(tx, id, principal.tenantId);
      })
      .catch((error: unknown) => {
        // Kapsam trigger'ı: FK doğrulaması RLS'i bypass ettiği için BAŞKA bir
        // kiracının şube kimliği FK'dan geçer, kurala trigger'da takılır.
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Rol ve şube uyumsuz', {
            detail: 'Seçilen şube bu kliniğe ait değil ya da rolün kapsamıyla uyuşmuyor.',
            cause: error,
          });
        }
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Şube bulunamadı');
        }
        throw error;
      });

    // İzinler token'da TAŞINMADIĞI için cache düşürmek yeterli: sonraki istek
    // yeni rolle çözümlenir. Rol değişiminin ANINDA etkili olması Faz 1'in
    // token tasarımındaki gerekçenin ta kendisi.
    this.principals.invalidateUser(id);

    return rows.map((row) => UsersService.toMembershipResponse(row));
  }

  /**
   * Kiracının son işletme sahibi kaldırılamaz.
   *
   * SAVUNMA DERİNLİĞİ: bugünkü rol kümesiyle bu dal fiilen tetiklenemez —
   * son sahibi kaldırabilecek tek aktör en az `owner` rank'inde olmalı, o da
   * kendisi bir sahip demektir ve sahip iki taneyse "son" değildir; aktörün
   * kendisi olması durumunu da kendi rollerine dokunma yasağı kesiyor. Kural
   * yine de burada duruyor çünkü rank/izin dağılımı değişirse sessizce
   * açılacak açık, sahipsiz kalmış bir kiracıdır ve onu yalnız platform
   * kurtarabilir.
   */
  private async assertOwnerSurvives(
    tx: Parameters<Parameters<TenantTxService['run']>[0]>[0],
    tenantId: string,
    userId: string,
    removed: identityRepo.MembershipRow[],
    desiredKeys: ReadonlySet<string>,
  ): Promise<void> {
    const losesOwner =
      removed.some((row) => row.roleKey === ROLES.OWNER) &&
      ![...desiredKeys].some((key) => key.startsWith(`${ROLES.OWNER}:`));
    if (!losesOwner) return;

    const owners = await identityRepo.listMembershipsByRole(tx, tenantId, ROLES.OWNER);
    if (!owners.some((row) => row.userId !== userId)) {
      throw AppError.conflict(
        ERROR_CODES.CONFLICT,
        'Kliniğin son işletme sahibi kaldırılamaz',
        { detail: 'Önce başka bir kullanıcıya işletme sahibi rolü verin.' },
      );
    }
  }

  private static assertDistinct(entries: { roleKey: RoleKey; branchId: string | null }[]): void {
    const keys = entries.map((entry) => `${entry.roleKey}:${entry.branchId ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Aynı rol ve şube birden fazla kez gönderilemez',
      );
    }
  }

  private static toMembershipResponse(
    membership: identityRepo.MembershipRow,
  ): MembershipResponseDto {
    return {
      id: membership.id,
      branchId: membership.branchId,
      roleKey: membership.roleKey,
      roleName: isRoleKey(membership.roleKey)
        ? ROLE_BY_KEY[membership.roleKey].name
        : membership.roleKey,
    };
  }

  private static toResponse(
    user: identityRepo.UserRow,
    memberships: identityRepo.MembershipRow[] = [],
  ): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
      isActive: user.isActive,
      phone: user.phone,
      phoneVerified: user.phoneVerifiedAt !== null,
      hasPassword: user.passwordHash !== null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      memberships: memberships.map((membership) => UsersService.toMembershipResponse(membership)),
    };
  }
}
