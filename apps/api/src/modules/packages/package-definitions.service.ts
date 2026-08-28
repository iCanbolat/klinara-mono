import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { versionConflict } from '../../common/http/etag';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  toPage,
  type Page,
} from '../../common/pagination';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { BranchAccessService } from '../tenancy/branch-access.service';
import type { Principal } from '../identity/principal';
import * as repo from './package-definitions.repository';
import type {
  CreatePackageDefinitionDto,
  ListPackageDefinitionsQueryDto,
  PackageDefinitionItemInputDto,
  PackageDefinitionResponseDto,
  UpdatePackageDefinitionDto,
} from './dto/package-definition.dto';

@Injectable()
export class PackageDefinitionsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async list(query: ListPackageDefinitionsQueryDto): Promise<Page<PackageDefinitionResponseDto>> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);

    const { rows, items } = await this.tx.run(async (tx) => {
      const found = await repo.listDefinitions(tx, {
        limit: limit + 1,
        cursorCreatedAt: cursor?.sortKey,
        cursorId: cursor?.id,
        branchId: query.branchId,
        serviceId: query.serviceId,
        isActive: query.isActive,
      });
      return {
        rows: found,
        items: await repo.listItemsForDefinitions(
          tx,
          found.map((row) => row.id),
        ),
      };
    });

    const page = toPage(rows, limit, repo.listDefinitionsOrderKey);
    return {
      data: page.data.map((row) =>
        PackageDefinitionsService.toResponse(row, items.get(row.id) ?? []),
      ),
      pageInfo: page.pageInfo,
    };
  }

  async get(id: string): Promise<PackageDefinitionResponseDto> {
    const payload = await this.tx.run((tx) => this.load(tx, id));
    if (payload === undefined) throw AppError.notFound('Paket tanımı bulunamadı');
    return payload;
  }

  async create(
    principal: Principal,
    input: CreatePackageDefinitionDto,
  ): Promise<PackageDefinitionResponseDto> {
    PackageDefinitionsService.assertDistinctServices(input.items);
    if (input.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, input.branchId);
    }

    return this.tx
      .run(async (tx) => {
        const row = await repo.insertDefinition(tx, {
          tenantId: this.tx.tenantId,
          branchId: input.branchId ?? null,
          slug: input.slug.toLowerCase(),
          name: input.name.trim(),
          description: input.description ?? null,
          totalPriceMinor: input.totalPriceMinor,
          validityDays: input.validityDays ?? null,
          isTransferable: input.isTransferable ?? true,
          isOnlineSellable: input.isOnlineSellable ?? false,
          isActive: input.isActive ?? true,
        });
        await repo.replaceItems(tx, {
          tenantId: this.tx.tenantId,
          definitionId: row.id,
          items: input.items,
        });
        const loaded = await this.load(tx, row.id);
        if (loaded === undefined) throw new Error('Paket tanımı yazıldıktan sonra okunamadı');
        return loaded;
      })
      .catch((error: unknown) => {
        throw PackageDefinitionsService.translate(error);
      });
  }

  async update(
    id: string,
    expectedVersion: number,
    input: UpdatePackageDefinitionDto,
  ): Promise<PackageDefinitionResponseDto> {
    if (input.items !== undefined) {
      PackageDefinitionsService.assertDistinctServices(input.items);
    }

    const payload = await this.tx
      .run(async (tx) => {
        const row = await repo.updateWithVersion(tx, id, expectedVersion, {
          name: input.name?.trim(),
          description: input.description,
          totalPriceMinor: input.totalPriceMinor,
          validityDays: input.validityDays,
          isTransferable: input.isTransferable,
          isOnlineSellable: input.isOnlineSellable,
          isActive: input.isActive,
        });
        if (row === undefined) {
          // Satır yok mu, sürüm mü tutmadı — ayırmak için ikinci bir okuma
          // gerekiyor; 404 ile 409 istemci için tamamen farklı iki cevap.
          const current = await repo.findDefinitionById(tx, id);
          return current === undefined ? undefined : { conflict: true as const };
        }
        if (input.items !== undefined) {
          await repo.replaceItems(tx, {
            tenantId: this.tx.tenantId,
            definitionId: id,
            items: input.items,
          });
        }
        return this.load(tx, id);
      })
      .catch((error: unknown) => {
        throw PackageDefinitionsService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Paket tanımı bulunamadı');
    if ('conflict' in payload) throw versionConflict();
    return payload;
  }

  /**
   * Emekliye ayırma.
   *
   * Satılmış bir tanım SİLİNMEZ, yalnız pasife alınır: satışlar snapshot
   * üzerinden yaşamaya devam eder ama tanım kimlik olarak ayakta kalmalıdır,
   * aksi hâlde "bu paket hangi tanımdan satıldı" izi kopardı.
   */
  async remove(id: string, expectedVersion: number): Promise<void> {
    const payload = await this.tx
      .run(async (tx) => {
        // Satılmışsa arşivlenmez, yalnız pasife alınır. Aynı kural DB'de de
        // var (package_definitions_guard_delete, K0007); burada sormamızın
        // sebebi tek bir uçtan iki davranışı da sunabilmek.
        const sold = await repo.hasSales(tx, id);
        const row = await repo.updateWithVersion(tx, id, expectedVersion, {
          isActive: false,
          deletedAt: sold ? undefined : new Date(),
        });
        if (row === undefined) {
          const current = await repo.findDefinitionById(tx, id);
          return current === undefined ? undefined : { conflict: true as const };
        }
        return { ok: true as const };
      })
      .catch((error: unknown) => {
        throw PackageDefinitionsService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Paket tanımı bulunamadı');
    if ('conflict' in payload) throw versionConflict();
  }

  private async load(tx: Tx, id: string): Promise<PackageDefinitionResponseDto | undefined> {
    const row = await repo.findDefinitionById(tx, id);
    if (row === undefined) return undefined;
    const items = await repo.listItemsForDefinitions(tx, [id]);
    return PackageDefinitionsService.toResponse(row, items.get(id) ?? []);
  }

  private static assertDistinctServices(items: PackageDefinitionItemInputDto[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.serviceId)) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Aynı hizmet iki kez verilemez', {
          extra: { errors: [{ path: 'items', message: `Tekrarlanan hizmet: ${item.serviceId}` }] },
        });
      }
      seen.add(item.serviceId);
    }
  }

  private static toResponse(
    row: repo.PackageDefinitionRow,
    items: repo.PackageDefinitionItemRow[],
  ): PackageDefinitionResponseDto {
    return {
      id: row.id,
      branchId: row.branchId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      totalPriceMinor: row.totalPriceMinor,
      listPriceMinor: items.reduce(
        (sum, item) => sum + item.unitListPriceMinor * item.quantity,
        0,
      ),
      currency: row.currency,
      validityDays: row.validityDays,
      isTransferable: row.isTransferable,
      isOnlineSellable: row.isOnlineSellable,
      isActive: row.isActive,
      revision: row.revision,
      version: row.version,
      items: items.map((item) => ({
        id: item.id,
        serviceId: item.serviceId,
        serviceName: item.serviceName,
        quantity: item.quantity,
        unitListPriceMinor: item.unitListPriceMinor,
        sortOrder: item.sortOrder,
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu slug zaten kullanılıyor');
    }
    if (isPgError(error, PG_ERROR.INACTIVE_SERVICE)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Pasif hizmet pakete eklenemez');
    }
    if (isPgError(error, PG_ERROR.PACKAGE_DEFINITION_IN_USE)) {
      return AppError.conflict(
        ERROR_CODES.CONFLICT,
        'Satılmış paket tanımı silinemez',
        { detail: 'Tanım pasife alınabilir; satılmış paketler snapshot üzerinden yaşar.' },
      );
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Paket tanımı geçersiz');
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Hizmet ya da şube bulunamadı');
    }
    return error;
  }
}
