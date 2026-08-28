import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, pgConstraintName, PG_ERROR } from '../../common/errors/db-errors';
import { allocateMinor, remainingValueMinor } from '../../common/money';
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
import * as definitionsRepo from './package-definitions.repository';
import * as repo from './customer-packages.repository';
import type {
  CreateCustomerPackageDto,
  CustomerPackageResponseDto,
  ListCustomerPackagesQueryDto,
  ListLedgerQueryDto,
  PackageLedgerEntryResponseDto,
} from './dto/customer-package.dto';

@Injectable()
export class CustomerPackagesService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * Paket satışı.
   *
   * Snapshot burada alınır: tanım daha sonra değişse bile satılmış paket
   * kıpırdamaz. Sayaçlar servis tarafından YAZILMAZ — her kalem için bir
   * `purchase` defter satırı yazılır ve bakiyeyi apply trigger'ı doldurur.
   * Böylece `sum(delta) = remaining_sessions` invariant'ı satışın kendisinde
   * de geçerli olur.
   */
  async sell(
    principal: Principal,
    branchId: string,
    input: CreateCustomerPackageDto,
  ): Promise<CustomerPackageResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);

    return this.tx
      .run(async (tx) => {
        const definition = await definitionsRepo.findDefinitionById(tx, input.definitionId);
        if (definition === undefined) throw AppError.notFound('Paket tanımı bulunamadı');
        if (!definition.isActive) {
          throw new AppError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'Pasif paket tanımı satılamaz',
          );
        }
        if (definition.branchId !== null && definition.branchId !== branchId) {
          throw new AppError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'Bu paket bu şubede satılamaz',
          );
        }

        const items = (await definitionsRepo.listItemsForDefinitions(tx, [definition.id])).get(
          definition.id,
        );
        if (items === undefined || items.length === 0) {
          throw new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Paket tanımının kalemi yok');
        }

        const soldAt = input.soldAt === undefined ? new Date() : new Date(input.soldAt);
        const expiresAt =
          definition.validityDays === null
            ? null
            : new Date(soldAt.getTime() + definition.validityDays * 24 * 60 * 60 * 1000);

        // Kampanyalı satış fiyatı kalemlerin liste toplamına eşit değildir;
        // tahsis kuruş kaybı olmadan yapılmalı (bkz. common/money).
        const allocation = allocateMinor(
          definition.totalPriceMinor,
          items.map((item) => item.unitListPriceMinor * item.quantity),
        );

        const pkg = await repo.insertPackage(tx, {
          tenantId: this.tx.tenantId,
          customerId: input.customerId,
          branchId,
          definitionId: definition.id,
          definitionName: definition.name,
          definitionRevision: definition.revision,
          totalPriceMinor: definition.totalPriceMinor,
          currency: definition.currency,
          isTransferable: definition.isTransferable,
          validityDays: definition.validityDays,
          soldAt,
          expiresAt,
          soldBy: principal.userId,
          note: input.note ?? null,
        });

        const rows = await repo.insertItems(
          tx,
          items.map((item, index) => ({
            tenantId: this.tx.tenantId,
            customerPackageId: pkg.id,
            serviceId: item.serviceId,
            serviceName: item.serviceName,
            quantityTotal: item.quantity,
            unitListPriceMinor: item.unitListPriceMinor,
            itemTotalMinor: allocation[index] ?? 0,
            sortOrder: index,
          })),
        );

        for (const row of rows) {
          await repo.insertLedgerEntry(tx, {
            tenantId: this.tx.tenantId,
            customerPackageId: pkg.id,
            customerPackageItemId: row.id,
            entryType: 'purchase',
            delta: row.quantityTotal,
            actorUserId: principal.userId,
          });
        }

        const loaded = await this.load(tx, pkg.id);
        if (loaded === undefined) throw new Error('Paket yazıldıktan sonra okunamadı');
        return loaded;
      })
      .catch((error: unknown) => {
        throw CustomerPackagesService.translate(error);
      });
  }

  async listForCustomer(
    customerId: string,
    query: ListCustomerPackagesQueryDto,
  ): Promise<Page<CustomerPackageResponseDto>> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);

    const { rows, items } = await this.tx.run(async (tx) => {
      const found = await repo.listPackagesForCustomer(tx, {
        customerId,
        limit: limit + 1,
        cursorSoldAt: cursor?.sortKey,
        cursorId: cursor?.id,
        status: query.status,
      });
      return {
        rows: found,
        items: await repo.listItemsForPackages(
          tx,
          found.map((row) => row.id),
        ),
      };
    });

    const page = toPage(rows, limit, repo.listPackagesOrderKey);
    return {
      data: page.data.map((row) =>
        CustomerPackagesService.toResponse(row, items.get(row.id) ?? []),
      ),
      pageInfo: page.pageInfo,
    };
  }

  async get(id: string): Promise<CustomerPackageResponseDto> {
    const payload = await this.tx.run((tx) => this.load(tx, id));
    if (payload === undefined) throw AppError.notFound('Müşteri paketi bulunamadı');
    return payload;
  }

  async listLedger(
    id: string,
    query: ListLedgerQueryDto,
  ): Promise<Page<PackageLedgerEntryResponseDto>> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run(async (tx) => {
      const pkg = await repo.findPackageById(tx, id);
      if (pkg === undefined) return undefined;
      return repo.listLedger(tx, {
        customerPackageId: id,
        limit: limit + 1,
        cursorCreatedAt: cursor?.sortKey,
        cursorId: cursor?.id,
      });
    });
    if (rows === undefined) throw AppError.notFound('Müşteri paketi bulunamadı');

    const page = toPage(rows, limit, repo.ledgerOrderKey);
    return {
      data: page.data.map((row) => ({
        id: row.id,
        customerPackageItemId: row.customerPackageItemId,
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        entryType: row.entryType,
        delta: row.delta,
        appointmentId: row.appointmentId,
        actorUserId: row.actorUserId,
        reason: row.reason,
        reversesEntryId: row.reversesEntryId,
        createdAt: row.createdAt.toISOString(),
      })),
      pageInfo: page.pageInfo,
    };
  }

  async load(tx: Tx, id: string): Promise<CustomerPackageResponseDto | undefined> {
    const row = await repo.findPackageById(tx, id);
    if (row === undefined) return undefined;
    const items = await repo.listItemsForPackage(tx, id);
    return CustomerPackagesService.toResponse(row, items);
  }

  static toResponse(
    row: repo.CustomerPackageRow,
    items: repo.CustomerPackageItemRow[],
  ): CustomerPackageResponseDto {
    const mapped = items.map((item) => ({
      id: item.id,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      quantityTotal: item.quantityTotal,
      remainingSessions: item.remainingSessions,
      unitListPriceMinor: item.unitListPriceMinor,
      itemTotalMinor: item.itemTotalMinor,
      outstandingMinor: remainingValueMinor(
        item.itemTotalMinor,
        item.quantityTotal,
        item.remainingSessions,
      ),
      sortOrder: item.sortOrder,
    }));

    return {
      id: row.id,
      customerId: row.customerId,
      branchId: row.branchId,
      definitionId: row.definitionId,
      name: row.definitionName,
      definitionRevision: row.definitionRevision,
      totalPriceMinor: row.totalPriceMinor,
      currency: row.currency,
      isTransferable: row.isTransferable,
      validityDays: row.validityDays,
      soldAt: row.soldAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      status: row.status,
      remainingSessions: row.remainingSessions,
      outstandingMinor: mapped.reduce((sum, item) => sum + item.outstandingMinor, 0),
      refundedSessions: row.refundedSessions,
      refundAmountMinor: row.refundAmountMinor,
      refundSettlementStatus: row.refundSettlementStatus,
      refundedAt: row.refundedAt?.toISOString() ?? null,
      refundReason: row.refundReason,
      transferredFromPackageId: row.transferredFromPackageId,
      note: row.note,
      version: row.version,
      items: mapped,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Defter kaynaklı hataların istemci karşılıkları.
   *
   * `K0004` genel `check_violation`dan AYRI bir SQLSTATE: aynı şemada 23514
   * hem kiracı kapsamı hem tavan ihlali anlamına geliyor ve ikisi istemciye
   * tamamen farklı mesajlarla dönmeli.
   */
  static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.PACKAGE_EXHAUSTED)) {
      return AppError.conflict(ERROR_CODES.PACKAGE_EXHAUSTED, 'Paket hakkı yetersiz', {
        detail: 'Bu kalemde kalan seans hakkı yok.',
      });
    }
    if (isPgError(error, PG_ERROR.PACKAGE_NOT_CONSUMABLE)) {
      return AppError.conflict(ERROR_CODES.PACKAGE_EXPIRED, 'Paket kullanılabilir durumda değil', {
        detail: 'Paketin geçerlilik süresi dolmuş ya da paket iade/devir edilmiş.',
      });
    }
    if (isPgError(error, PG_ERROR.PACKAGE_BINDING_INVALID)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Randevu kalemi bu paket kalemine bağlanamaz',
        {
          detail:
            'Paket, randevunun müşterisine ve hizmetine ait ve aynı şubede satılmış olmalıdır.',
        },
      );
    }
    if (isPgError(error, PG_ERROR.PACKAGE_NOT_TRANSFERABLE)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu paket devredilemez');
    }
    if (isPgError(error, PG_ERROR.RESTRICT_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Defter satırı değiştirilemez veya silinemez');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      const constraint = pgConstraintName(error);
      if (constraint?.endsWith('remaining_non_negative') === true) {
        return AppError.conflict(ERROR_CODES.PACKAGE_EXHAUSTED, 'Paket hakkı yetersiz');
      }
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Paket işlemi geçersiz');
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Müşteri, şube ya da hizmet bulunamadı');
    }
    return error;
  }
}
