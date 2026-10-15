import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PLAN_KEY,
  ERROR_CODES,
  ROLE_BY_KEY,
  type TenantPlanInfo,
  type TenantSetupStatus,
} from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { setTenantContext } from '../../database/tenant-tx';
import { TenantTxService } from '../../database/tenant-tx.service';
import { BookingPageCacheService } from '../booking-page/booking-page-cache.service';
import { BranchAccessService } from './branch-access.service';
import { InvitationsService } from '../identity/invitations.service';
import * as repo from './tenancy.repository';
import { canAccessBranch, type Principal } from '../identity/principal';
import { assertCanAddBranch, getTenantPlanInfo } from './plan-limits';
import { getSetupStatus } from './setup-status';
import type {
  BranchResponseDto,
  CreateBranchDto,
  CreateTenantDto,
  CreateTenantResponseDto,
  TenantResponseDto,
  TenantSettingsResponseDto,
  UpdateBranchDto,
  UpdateTenantDto,
  UpdateTenantSettingsDto,
} from './dto/tenant.dto';

export function toTenantResponse(row: repo.TenantRow): TenantResponseDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSettingsResponse(row: repo.TenantSettingsRow): TenantSettingsResponseDto {
  return {
    slotGranularityMinutes: row.slotGranularityMinutes,
    preventCustomerDoubleBooking: row.preventCustomerDoubleBooking,
    reminderHoursBefore: row.reminderHoursBefore,
    cancelWindowHours: row.cancelWindowHours,
    minLeadMinutes: row.minLeadMinutes,
    maxAdvanceDays: row.maxAdvanceDays,
    requireMfaForAdmins: row.requireMfaForAdmins,
  };
}

export function toBranchResponse(row: repo.BranchRow): BranchResponseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    phone: row.phone,
    address: row.address,
    mapsUrl: row.mapsUrl,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TenancyService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly invitations: InvitationsService,
    private readonly branchAccess: BranchAccessService,
    private readonly bookingPage: BookingPageCacheService,
  ) {}

  /**
   * Yeni kiracı + ilk şube + varsayılan ayarlar + işletme sahibi daveti.
   *
   * Kiracı satırı yazıldıktan HEMEN SONRA context o kiracıya daraltılır;
   * devamındaki yazımlar platform istisnasıyla değil, NORMAL kiracı
   * politikasıyla geçer.
   *
   * Sahip daveti aynı transaction'da oluşur: kiracı açılır ama içine kimse
   * giremezse iş görmez, ve platform yöneticisinin kiracı verisine erişimi
   * yoktur (olmamalıdır da). Kullanıcı hesabı davet KABUL EDİLİNCE açılır.
   */
  async createTenant(input: CreateTenantDto): Promise<CreateTenantResponseDto> {
    const result = await this.tx
      .runAsPlatform(async (tx) => {
        const tenant = await repo.insertTenant(tx, {
          slug: input.slug,
          name: input.name,
          timezone: input.timezone,
          currency: input.currency,
          planKey: input.planKey ?? DEFAULT_PLAN_KEY,
          maxBranchesOverride: input.maxBranchesOverride ?? null,
          maxPractitionersOverride: input.maxPractitionersOverride ?? null,
        });
        await setTenantContext(tx, tenant.id);
        await repo.insertDefaultSettings(tx, tenant.id);
        const branch = await repo.insertBranch(tx, {
          tenantId: tenant.id,
          slug: input.branch.slug,
          name: input.branch.name,
          timezone: input.branch.timezone ?? input.timezone,
        });
        const invitation = await this.invitations.createOwnerInvitation(tx, {
          tenantId: tenant.id,
          email: input.owner.email,
          fullName: input.owner.fullName,
        });
        return { tenant, branch, invitation };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu alan adı (slug) zaten kullanımda', {
            detail: `"${input.slug}" başka bir klinik tarafından alınmış.`,
          });
        }
        throw error;
      });

    const { invitation, token, link } = result.invitation;
    const mailDelivered = await this.invitations.sendInvitationMail(invitation.email, link, {
      tenantName: result.tenant.name,
      roleName: ROLE_BY_KEY.owner.name,
    });

    return {
      tenant: toTenantResponse(result.tenant),
      branch: toBranchResponse(result.branch),
      ownerInvitation: {
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
        mailDelivered,
        ...(this.invitations.tokenVisible ? { token, link } : {}),
      },
    };
  }

  async getTenant(): Promise<TenantResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx.run((tx) => repo.findTenantById(tx, tenantId));
    if (row === undefined) throw AppError.notFound('Kiracı bulunamadı');
    return toTenantResponse(row);
  }

  async updateTenant(input: UpdateTenantDto): Promise<TenantResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx.run((tx) => repo.updateTenant(tx, tenantId, input));
    if (row === undefined) throw AppError.notFound('Kiracı bulunamadı');
    await this.bookingPage.invalidate('tenant');
    return toTenantResponse(row);
  }

  async getSettings(): Promise<TenantSettingsResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx.run((tx) => repo.getSettings(tx, tenantId));
    if (row === undefined) throw AppError.notFound('Kiracı ayarları bulunamadı');
    return toSettingsResponse(row);
  }

  async updateSettings(input: UpdateTenantSettingsDto): Promise<TenantSettingsResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx.run((tx) => repo.updateSettings(tx, tenantId, input));
    if (row === undefined) throw AppError.notFound('Kiracı ayarları bulunamadı');
    await this.bookingPage.invalidate('tenant-settings');
    return toSettingsResponse(row);
  }

  /** Plan, geçerli limitler ve kullanım — panelde "Plan ve kullanım" kartı. */
  async getPlan(): Promise<TenantPlanInfo> {
    const tenantId = this.tx.tenantId;
    return this.tx.run((tx) => getTenantPlanInfo(tx, tenantId));
  }

  async getSetupStatus(): Promise<TenantSetupStatus> {
    const tenantId = this.tx.tenantId;
    return this.tx.run((tx) => getSetupStatus(tx, tenantId));
  }

  /** Seçicilerde kullanıcının üye olmadığı şube görünmesin (aksi hâlde 403). */
  async listBranches(principal: Principal): Promise<BranchResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listBranches(tx));
    return rows.filter((row) => canAccessBranch(principal, row.id)).map(toBranchResponse);
  }

  async createBranch(input: CreateBranchDto): Promise<BranchResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx
      .run(async (tx) => {
        const tenant = await repo.findTenantById(tx, tenantId);
        if (tenant === undefined) throw AppError.notFound('Kiracı bulunamadı');
        await assertCanAddBranch(tx, tenantId);
        return repo.insertBranch(tx, {
          tenantId,
          slug: input.slug,
          name: input.name,
          timezone: input.timezone ?? tenant.timezone,
          phone: input.phone,
          address: input.address,
          mapsUrl: input.mapsUrl,
        });
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu şube kodu zaten kullanımda', {
            detail: `"${input.slug}" bu klinikte başka bir şubeye ait.`,
          });
        }
        throw error;
      });

    // Yeni şube, erişim cache'i TTL'i dolana kadar "bu kiracıya ait değil"
    // görünürdü — yani açılan şube bir dakika boyunca 403 verirdi.
    this.branchAccess.invalidateTenant(tenantId);
    await this.bookingPage.invalidate('branch');
    return toBranchResponse(row);
  }

  async updateBranch(id: string, input: UpdateBranchDto): Promise<BranchResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx.run(async (tx) => {
      // Pasif şubeyi yeniden açmak, yeni şube açmakla aynı kapasiteyi kullanır.
      if (input.isActive === true) {
        const current = await repo.findBranchById(tx, id);
        if (current !== undefined && !current.isActive) await assertCanAddBranch(tx, tenantId);
      }
      return repo.updateBranch(tx, id, input);
    });
    // RLS sayesinde başka kiracının şubesi de burada "bulunamadı" olur —
    // varlığını bile sızdırmaz.
    if (row === undefined) throw AppError.notFound('Şube bulunamadı');
    // Şube pasifleştirilmiş veya silinmiş olabilir.
    this.branchAccess.invalidateTenant(this.tx.tenantId);
    await this.bookingPage.invalidate('branch');
    return toBranchResponse(row);
  }
}
