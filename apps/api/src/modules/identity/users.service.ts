import { Injectable } from '@nestjs/common';
import { ROLE_BY_KEY, isRoleKey } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from './principal';
import { PrincipalService } from './principal.service';
import * as identityRepo from './identity.repository';
import type { MeResponseDto, UpdateUserDto, UserResponseDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly principals: PrincipalService,
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
      memberships: memberships.map((membership) => ({
        id: membership.id,
        branchId: membership.branchId,
        roleKey: membership.roleKey,
        roleName: isRoleKey(membership.roleKey)
          ? ROLE_BY_KEY[membership.roleKey].name
          : membership.roleKey,
      })),
    };
  }
}
