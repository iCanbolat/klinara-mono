import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { PG_ERROR, isPgError } from '../../common/errors/db-errors';
import { DEFAULT_PAGE_SIZE, decodeCursor, toPage } from '../../common/pagination';
import { versionConflict } from '../../common/http/etag';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Principal } from '../identity/principal';
import * as repo from './finance.repository';
import type {
  CreateDiscountDto,
  DiscountPageDto,
  DiscountResponseDto,
  ListDiscountsQueryDto,
  UpdateDiscountDto,
} from './dto/discount.dto';

@Injectable()
export class DiscountsService {
  constructor(private readonly tx: TenantTxService) {}

  async create(principal: Principal, input: CreateDiscountDto): Promise<DiscountResponseDto> {
    const scope = input.scope ?? 'all';
    if ((scope === 'all') !== (input.scopeRefId === undefined)) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Kapsam ile kapsam hedefi uyuşmuyor',
        {
          detail:
            "`scope='all'` ise hedef verilmez; hizmet ya da paket kapsamında ise zorunludur.",
        },
      );
    }

    const row = await this.tx
      .run((tx) =>
        repo.insertDiscount(tx, {
          tenantId: principal.tenantId,
          code: input.code ?? null,
          name: input.name,
          kind: input.kind,
          value: input.value,
          scope,
          scopeRefId: input.scopeRefId ?? null,
          startsAt: input.startsAt === undefined ? null : new Date(input.startsAt),
          endsAt: input.endsAt === undefined ? null : new Date(input.endsAt),
          maxRedemptions: input.maxRedemptions ?? null,
        }),
      )
      .catch((error: unknown) => {
        throw DiscountsService.translate(error);
      });

    return DiscountsService.present(row);
  }

  async get(id: string): Promise<DiscountResponseDto> {
    const row = await this.tx.run((tx) => repo.findDiscountById(tx, id));
    if (row === undefined) throw AppError.notFound('İndirim bulunamadı');
    return DiscountsService.present(row);
  }

  async list(query: ListDiscountsQueryDto): Promise<DiscountPageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run((tx) =>
      repo.listDiscounts(tx, { activeOnly: query.activeOnly }, { limit, cursor }),
    );
    const page = toPage(rows, limit, (row) => ({
      sortKey: row.createdAt.toISOString(),
      id: row.id,
    }));

    return {
      data: page.data.map((row) => DiscountsService.present(row)),
      pageInfo: page.pageInfo,
    };
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdateDiscountDto,
  ): Promise<DiscountResponseDto> {
    const row = await this.tx
      .run((tx) =>
        repo.updateDiscountWithVersion(tx, id, expectedVersion, {
          name: input.name,
          endsAt: input.endsAt === undefined ? undefined : new Date(input.endsAt),
          maxRedemptions: input.maxRedemptions,
          isActive: input.isActive,
        }),
      )
      .catch((error: unknown) => {
        throw DiscountsService.translate(error);
      });

    if (row === undefined) {
      const exists = await this.tx.run((tx) => repo.findDiscountById(tx, id));
      if (exists === undefined) throw AppError.notFound('İndirim bulunamadı');
      throw versionConflict();
    }
    return DiscountsService.present(row);
  }

  /**
   * Soft delete.
   *
   * Kullanılmış bir indirim tanımı SİLİNMEZ, pasife alınır — `charges` satırı
   * ona referans veriyor ve "hangi kampanyayla satıldı" sorusu yıllar sonra da
   * cevaplanabilir olmalı. Gerekçe `package_definitions` (0024) ile aynı.
   */
  async remove(id: string, expectedVersion: number): Promise<void> {
    const row = await this.tx.run((tx) =>
      repo.updateDiscountWithVersion(tx, id, expectedVersion, {
        deletedAt: new Date(),
        isActive: false,
      }),
    );
    if (row === undefined) {
      const exists = await this.tx.run((tx) => repo.findDiscountById(tx, id));
      if (exists === undefined) throw AppError.notFound('İndirim bulunamadı');
      throw versionConflict();
    }
  }

  static present(row: repo.DiscountRow): DiscountResponseDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      value: row.value,
      scope: row.scope,
      scopeRefId: row.scopeRefId,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      maxRedemptions: row.maxRedemptions,
      redeemedCount: row.redeemedCount,
      isActive: row.isActive,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu kampanya kodu zaten kullanılıyor');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'İndirim tanımı geçersiz', {
        detail: 'Yüzde indirimi %100’ü, tarih aralığı ise ters sırayı aşamaz.',
      });
    }
    return error;
  }
}
