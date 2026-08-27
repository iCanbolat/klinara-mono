import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import * as repo from './catalog.repository';
import type {
  BranchServiceOverrideInputDto,
  BranchServiceOverrideResponseDto,
  CreateServiceCategoryDto,
  CreateServiceDto,
  ServiceCategoryResponseDto,
  ServiceResponseDto,
  UpdateServiceCategoryDto,
  UpdateServiceDto,
} from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly availabilityCache: AvailabilityCacheService,
  ) {}

  /**
   * Katalog değişimi uygunluğu bayatlatır: süre ve buffer slot bloğunu
   * belirler, aktiflik ise hizmetin randevuya açık olup olmadığını.
   */
  private invalidateAvailability(): void {
    this.availabilityCache.invalidateTenant(this.tx.tenantId);
  }

  async listServiceCategories(): Promise<ServiceCategoryResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listServiceCategories(tx));
    return rows.map((row) => CatalogService.toCategoryResponse(row));
  }

  async createServiceCategory(input: CreateServiceCategoryDto): Promise<ServiceCategoryResponseDto> {
    const row = await this.tx
      .run((tx) =>
        repo.insertServiceCategory(tx, {
          tenantId: this.tx.tenantId,
          slug: input.slug,
          name: input.name,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        }),
      )
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu hizmet kategorisi kodu zaten kullanımda');
        }
        throw error;
      });

    this.invalidateAvailability();
    return CatalogService.toCategoryResponse(row);
  }

  async updateServiceCategory(
    id: string,
    input: UpdateServiceCategoryDto,
  ): Promise<ServiceCategoryResponseDto> {
    const row = await this.tx
      .run((tx) =>
        repo.updateServiceCategory(tx, id, {
          slug: input.slug,
          name: input.name,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        }),
      )
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu hizmet kategorisi kodu zaten kullanımda');
        }
        throw error;
      });

    if (row === undefined) throw AppError.notFound('Hizmet kategorisi bulunamadı');
    this.invalidateAvailability();
    return CatalogService.toCategoryResponse(row);
  }

  async deactivateServiceCategory(id: string): Promise<ServiceCategoryResponseDto> {
    const updated = await this.tx.run(async (tx) => {
      const activeServiceCount = await repo.countActiveServicesInCategory(tx, id);
      if (activeServiceCount > 0) {
        throw AppError.conflict(
          ERROR_CODES.CONFLICT,
          'Kullanımda olan hizmet kategorisi pasife alınamaz',
          {
            detail: 'Önce bu kategoriye bağlı aktif hizmetleri pasife alın.',
          },
        );
      }
      return repo.updateServiceCategory(tx, id, { isActive: false });
    });

    if (updated === undefined) throw AppError.notFound('Hizmet kategorisi bulunamadı');
    this.invalidateAvailability();
    return CatalogService.toCategoryResponse(updated);
  }

  async listServices(): Promise<ServiceResponseDto[]> {
    const payload = await this.tx.run(async (tx) => {
      const rows = await repo.listServices(tx);
      const overrides = await repo.listOverridesForServices(
        tx,
        rows.map((row) => row.id),
      );
      return { rows, overrides };
    });

    const byService = new Map<string, repo.BranchServiceOverrideRow[]>();
    for (const override of payload.overrides) {
      const list = byService.get(override.serviceId) ?? [];
      list.push(override);
      byService.set(override.serviceId, list);
    }

    return payload.rows.map((row) =>
      CatalogService.toServiceResponse(row, byService.get(row.id) ?? []),
    );
  }

  async getService(id: string): Promise<ServiceResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const service = await repo.findServiceById(tx, id);
      if (service === undefined) return undefined;
      const overrides = await repo.listOverridesForService(tx, id);
      return { service, overrides };
    });

    if (payload === undefined) throw AppError.notFound('Hizmet bulunamadı');
    return CatalogService.toServiceResponse(payload.service, payload.overrides);
  }

  async createService(input: CreateServiceDto): Promise<ServiceResponseDto> {
    CatalogService.assertOverrides(input.branchOverrides);

    const payload = await this.tx
      .run(async (tx) => {
        const service = await repo.insertService(tx, {
          tenantId: this.tx.tenantId,
          categoryId: input.categoryId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          durationMinutes: input.durationMinutes,
          bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
          bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
          priceMinor: input.priceMinor,
          vatRateBasisPoints: input.vatRateBasisPoints ?? 2000,
          calendarColor: input.calendarColor,
          isOnlineBookable: input.isOnlineBookable ?? true,
          isActive: input.isActive ?? true,
        });

        const overrides = input.branchOverrides ?? [];
        await repo.replaceServiceOverrides(tx, this.tx.tenantId, service.id, overrides);
        const rows = await repo.listOverridesForService(tx, service.id);
        return { service, overrides: rows };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu hizmet kodu zaten kullanımda');
        }
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Hizmet kategorisi veya şube bulunamadı');
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Kategori ve şube bu kiracıya ait olmalı',
          );
        }
        throw error;
      });

    this.invalidateAvailability();
    return CatalogService.toServiceResponse(payload.service, payload.overrides);
  }

  async updateService(id: string, input: UpdateServiceDto): Promise<ServiceResponseDto> {
    CatalogService.assertOverrides(input.branchOverrides);

    const payload = await this.tx
      .run(async (tx) => {
        const service = await repo.updateService(tx, id, {
          categoryId: input.categoryId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          durationMinutes: input.durationMinutes,
          bufferBeforeMinutes: input.bufferBeforeMinutes,
          bufferAfterMinutes: input.bufferAfterMinutes,
          priceMinor: input.priceMinor,
          vatRateBasisPoints: input.vatRateBasisPoints,
          calendarColor: input.calendarColor,
          isOnlineBookable: input.isOnlineBookable,
          isActive: input.isActive,
        });
        if (service === undefined) return undefined;

        if (input.branchOverrides !== undefined) {
          await repo.replaceServiceOverrides(tx, this.tx.tenantId, service.id, input.branchOverrides);
        }

        const overrides = await repo.listOverridesForService(tx, service.id);
        return { service, overrides };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu hizmet kodu zaten kullanımda');
        }
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Hizmet kategorisi veya şube bulunamadı');
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Kategori ve şube bu kiracıya ait olmalı',
          );
        }
        throw error;
      });

    if (payload === undefined) throw AppError.notFound('Hizmet bulunamadı');
    this.invalidateAvailability();
    return CatalogService.toServiceResponse(payload.service, payload.overrides);
  }

  async deactivateService(id: string): Promise<ServiceResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const service = await repo.updateService(tx, id, { isActive: false });
      if (service === undefined) return undefined;
      const overrides = await repo.listOverridesForService(tx, service.id);
      return { service, overrides };
    });

    if (payload === undefined) throw AppError.notFound('Hizmet bulunamadı');
    this.invalidateAvailability();
    return CatalogService.toServiceResponse(payload.service, payload.overrides);
  }

  private static assertOverrides(overrides?: BranchServiceOverrideInputDto[]): void {
    if (overrides === undefined) return;

    for (const override of overrides) {
      const hasAnyValue =
        override.durationMinutes !== undefined ||
        override.bufferBeforeMinutes !== undefined ||
        override.bufferAfterMinutes !== undefined ||
        override.priceMinor !== undefined ||
        override.vatRateBasisPoints !== undefined ||
        override.isOnlineBookable !== undefined ||
        override.isActive !== undefined;

      if (!hasAnyValue) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Şube override kaydı en az bir alan içermelidir',
        );
      }
    }
  }

  private static toCategoryResponse(row: repo.ServiceCategoryRow): ServiceCategoryResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      slug: row.slug,
      name: row.name,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private static toOverrideResponse(
    row: repo.BranchServiceOverrideRow,
  ): BranchServiceOverrideResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      serviceId: row.serviceId,
      branchId: row.branchId,
      durationMinutes: row.durationMinutes,
      bufferBeforeMinutes: row.bufferBeforeMinutes,
      bufferAfterMinutes: row.bufferAfterMinutes,
      priceMinor: row.priceMinor,
      vatRateBasisPoints: row.vatRateBasisPoints,
      isOnlineBookable: row.isOnlineBookable,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private static toServiceResponse(
    row: repo.ServiceRow,
    overrides: repo.BranchServiceOverrideRow[],
  ): ServiceResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      categoryId: row.categoryId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      durationMinutes: row.durationMinutes,
      bufferBeforeMinutes: row.bufferBeforeMinutes,
      bufferAfterMinutes: row.bufferAfterMinutes,
      priceMinor: row.priceMinor,
      vatRateBasisPoints: row.vatRateBasisPoints,
      calendarColor: row.calendarColor,
      isOnlineBookable: row.isOnlineBookable,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      branchOverrides: overrides.map((override) => CatalogService.toOverrideResponse(override)),
    };
  }
}
