import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { TenantTxService } from '../../database/tenant-tx.service';
import { AvailabilityCacheService } from '../booking/availability-cache.service';
import * as repo from './staff.repository';
import type {
  CreateStaffProfileDto,
  ReplaceStaffServicesDto,
  StaffProfileResponseDto,
  StaffServiceInputDto,
  StaffServiceResponseDto,
  UpdateStaffProfileDto,
} from './dto/staff.dto';

@Injectable()
export class StaffService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly availabilityCache: AvailabilityCacheService,
  ) {}

  /** Uygunluğu etkileyen her yazımdan sonra kiracının cache'i düşürülür. */
  private invalidateAvailability(): void {
    this.availabilityCache.invalidateTenant(this.tx.tenantId);
  }

  async listStaffProfiles(): Promise<StaffProfileResponseDto[]> {
    const payload = await this.tx.run(async (tx) => {
      const profiles = await repo.listStaffProfiles(tx);
      const services = await repo.listStaffServicesForProfiles(
        tx,
        profiles.map((profile) => profile.id),
      );
      return { profiles, services };
    });

    const byProfile = new Map<string, repo.StaffServiceRow[]>();
    for (const competency of payload.services) {
      const rows = byProfile.get(competency.staffProfileId) ?? [];
      rows.push(competency);
      byProfile.set(competency.staffProfileId, rows);
    }

    return payload.profiles.map((profile) =>
      StaffService.toProfileResponse(profile, byProfile.get(profile.id) ?? []),
    );
  }

  async getStaffProfile(id: string): Promise<StaffProfileResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const profile = await repo.findStaffProfileById(tx, id);
      if (profile === undefined) return undefined;
      const services = await repo.listStaffServicesForProfile(tx, id);
      return { profile, services };
    });

    if (payload === undefined) throw AppError.notFound('Personel profili bulunamadı');
    return StaffService.toProfileResponse(payload.profile, payload.services);
  }

  async createStaffProfile(input: CreateStaffProfileDto): Promise<StaffProfileResponseDto> {
    StaffService.assertNoDuplicateServices(input.services ?? []);

    const payload = await this.tx
      .run(async (tx) => {
        const profile = await repo.insertStaffProfile(tx, {
          tenantId: this.tx.tenantId,
          userId: input.userId,
          primaryBranchId: input.primaryBranchId,
          title: input.title,
          specialties: input.specialties ?? [],
          calendarColor: input.calendarColor,
          bio: input.bio,
          isVisibleOnline: input.isVisibleOnline ?? true,
          isActive: input.isActive ?? true,
        });

        const services = input.services ?? [];
        await repo.replaceStaffServices(tx, this.tx.tenantId, profile.id, services);

        const hydrated = await repo.findStaffProfileById(tx, profile.id);
        if (hydrated === undefined) throw AppError.notFound('Personel profili bulunamadı');
        const competencies = await repo.listStaffServicesForProfile(tx, profile.id);
        return { profile: hydrated, services: competencies };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Bu kullanıcı için personel profili zaten var');
        }
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Kullanıcı, şube veya hizmet bulunamadı');
        }
        if (isPgError(error, PG_ERROR.INACTIVE_SERVICE)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Pasif bir hizmete yetkinlik atanamaz; önce hizmeti tekrar aktif edin',
          );
        }
        // Kapsam trigger'ı: kullanıcı bu kiracının üyesi değil ya da şube
        // başka kiracıya ait. FK kontrolleri RLS'i BYPASS ettiği için bu
        // durumlar veritabanına kadar gelir ve burada 4xx'e çevrilmelidir.
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Personel profili açılamadı: kullanıcı bu kiracının aktif üyesi olmalı ve seçilen şube bu kiracıya ait olmalı',
          );
        }
        throw error;
      });

    this.invalidateAvailability();
    return StaffService.toProfileResponse(payload.profile, payload.services);
  }

  async updateStaffProfile(id: string, input: UpdateStaffProfileDto): Promise<StaffProfileResponseDto> {
    const payload = await this.tx
      .run(async (tx) => {
        const updated = await repo.updateStaffProfile(tx, id, {
          primaryBranchId: input.primaryBranchId,
          title: input.title,
          specialties: input.specialties,
          calendarColor: input.calendarColor,
          bio: input.bio,
          isVisibleOnline: input.isVisibleOnline,
          isActive: input.isActive,
        });

        if (updated === undefined) return undefined;

        const profile = await repo.findStaffProfileById(tx, id);
        if (profile === undefined) return undefined;
        const services = await repo.listStaffServicesForProfile(tx, id);
        return { profile, services };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Şube bulunamadı');
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(ERROR_CODES.CONFLICT, 'Seçilen şube bu kiracıya ait değil');
        }
        throw error;
      });

    if (payload === undefined) throw AppError.notFound('Personel profili bulunamadı');
    this.invalidateAvailability();
    return StaffService.toProfileResponse(payload.profile, payload.services);
  }

  async replaceStaffServices(
    id: string,
    input: ReplaceStaffServicesDto,
  ): Promise<StaffProfileResponseDto> {
    StaffService.assertNoDuplicateServices(input.services);

    const payload = await this.tx
      .run(async (tx) => {
        const profile = await repo.findStaffProfileById(tx, id);
        if (profile === undefined) return undefined;

        await repo.replaceStaffServices(tx, this.tx.tenantId, id, input.services);
        const services = await repo.listStaffServicesForProfile(tx, id);
        return { profile, services };
      })
      .catch((error: unknown) => {
        if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
          throw AppError.notFound('Hizmet veya şube bulunamadı');
        }
        if (isPgError(error, PG_ERROR.INACTIVE_SERVICE)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Pasif bir hizmete yetkinlik atanamaz; listeden çıkarın veya hizmeti aktif edin',
          );
        }
        if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Yetkinlik kaydedilemedi: hizmet ve şube bu kiracıya ait olmalı',
          );
        }
        throw error;
      });

    if (payload === undefined) throw AppError.notFound('Personel profili bulunamadı');
    this.invalidateAvailability();
    return StaffService.toProfileResponse(payload.profile, payload.services);
  }

  private static assertNoDuplicateServices(services: StaffServiceInputDto[]): void {
    const seen = new Set<string>();
    for (const competency of services) {
      const key = `${competency.serviceId}|${competency.branchId ?? 'tenant-wide'}`;
      if (seen.has(key)) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'Aynı hizmet/şube eşleşmesi birden fazla kez gönderilemez',
        );
      }
      seen.add(key);
    }
  }

  private static toServiceResponse(row: repo.StaffServiceRow): StaffServiceResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      staffProfileId: row.staffProfileId,
      serviceId: row.serviceId,
      branchId: row.branchId,
      customDurationMinutes: row.customDurationMinutes,
      customPriceMinor: row.customPriceMinor,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private static toProfileResponse(
    profile: repo.StaffProfileWithUser,
    services: repo.StaffServiceRow[],
  ): StaffProfileResponseDto {
    return {
      id: profile.id,
      tenantId: profile.tenantId,
      userId: profile.userId,
      userFullName: profile.userFullName,
      userEmail: profile.userEmail,
      primaryBranchId: profile.primaryBranchId,
      title: profile.title,
      specialties: profile.specialties,
      calendarColor: profile.calendarColor,
      bio: profile.bio,
      isVisibleOnline: profile.isVisibleOnline,
      isActive: profile.isActive,
      createdAt: profile.createdAt.toISOString(),
      services: services.map((service) => StaffService.toServiceResponse(service)),
    };
  }
}
