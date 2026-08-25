import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { setTenantContext } from '../../database/tenant-tx';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as repo from './tenancy.repository';
import type {
  BranchResponseDto,
  CreateBranchDto,
  CreateTenantDto,
  CreateTenantResponseDto,
  TenantResponseDto,
  TenantSettingsResponseDto,
  UpdateBranchDto,
  UpdateTenantDto,
} from './dto/tenant.dto';

function toTenantResponse(row: repo.TenantRow): TenantResponseDto {
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

function toBranchResponse(row: repo.BranchRow): BranchResponseDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class TenancyService {
  constructor(private readonly tx: TenantTxService) {}

  /**
   * Yeni kiracı + ilk şube + varsayılan ayarlar.
   *
   * Kiracı satırı yazıldıktan HEMEN SONRA context o kiracıya daraltılır;
   * devamındaki yazımlar platform istisnasıyla değil, NORMAL kiracı
   * politikasıyla geçer.
   */
  async createTenant(input: CreateTenantDto): Promise<CreateTenantResponseDto> {
    const result = await this.tx
      .runAsPlatform(async (tx) => {
        const tenant = await repo.insertTenant(tx, {
          slug: input.slug,
          name: input.name,
          timezone: input.timezone,
          currency: input.currency,
        });
        await setTenantContext(tx, tenant.id);
        await repo.insertDefaultSettings(tx, tenant.id);
        const branch = await repo.insertBranch(tx, {
          tenantId: tenant.id,
          slug: input.branch.slug,
          name: input.branch.name,
          timezone: input.branch.timezone ?? input.timezone,
        });
        return { tenant, branch };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu alan adı (slug) zaten kullanımda', {
            detail: `"${input.slug}" başka bir klinik tarafından alınmış.`,
          });
        }
        throw error;
      });

    return {
      tenant: toTenantResponse(result.tenant),
      branch: toBranchResponse(result.branch),
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
    return toTenantResponse(row);
  }

  async getSettings(): Promise<TenantSettingsResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx.run((tx) => repo.getSettings(tx, tenantId));
    if (row === undefined) throw AppError.notFound('Kiracı ayarları bulunamadı');
    return {
      slotGranularityMinutes: row.slotGranularityMinutes,
      preventCustomerDoubleBooking: row.preventCustomerDoubleBooking,
      reminderHoursBefore: row.reminderHoursBefore,
      cancelWindowHours: row.cancelWindowHours,
    };
  }

  async listBranches(): Promise<BranchResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listBranches(tx));
    return rows.map(toBranchResponse);
  }

  async createBranch(input: CreateBranchDto): Promise<BranchResponseDto> {
    const tenantId = this.tx.tenantId;
    const row = await this.tx
      .run(async (tx) => {
        const tenant = await repo.findTenantById(tx, tenantId);
        if (tenant === undefined) throw AppError.notFound('Kiracı bulunamadı');
        return repo.insertBranch(tx, {
          tenantId,
          slug: input.slug,
          name: input.name,
          timezone: input.timezone ?? tenant.timezone,
          phone: input.phone,
          address: input.address,
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

    return toBranchResponse(row);
  }

  async updateBranch(id: string, input: UpdateBranchDto): Promise<BranchResponseDto> {
    const row = await this.tx.run((tx) => repo.updateBranch(tx, id, input));
    // RLS sayesinde başka kiracının şubesi de burada "bulunamadı" olur —
    // varlığını bile sızdırmaz.
    if (row === undefined) throw AppError.notFound('Şube bulunamadı');
    return toBranchResponse(row);
  }
}
