import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, PERMISSIONS } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { PG_ERROR, isPgError, pgConstraintName } from '../../common/errors/db-errors';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  toPage,
  type Page,
} from '../../common/pagination';
import { versionConflict } from '../../common/http/etag';
import { TenantTxService } from '../../database/tenant-tx.service';
import { hasPermission, type Principal } from '../identity/principal';
import { BranchAccessService } from '../tenancy/branch-access.service';
import { computeChargeAmounts } from './charge-math';
import * as repo from './finance.repository';
import type {
  AccountEntryDto,
  ChargePageDto,
  ChargeResponseDto,
  CreateChargeDto,
  CustomerAccountDto,
  ListAccountQueryDto,
  ListChargesQueryDto,
  UpdateChargeDto,
} from './dto/charge.dto';

const DEFAULT_VAT_BASIS_POINTS = 2000;

@Injectable()
export class ChargesService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  /**
   * Elle ücret kalemi açar (ürün satışı ya da serbest kalem).
   *
   * Randevu ve paket kalemleri BURADAN geçmez: onlar kendi işlemlerinin
   * transaction'ında `ChargeGenerationService` ile doğar. Elle açılabilir
   * kaynakların listesi DTO'da kısıtlı — aksi hâlde bir randevunun ücreti
   * elle ikinci kez yazılabilirdi.
   */
  async create(
    principal: Principal,
    branchId: string,
    input: CreateChargeDto,
  ): Promise<ChargeResponseDto> {
    await this.branchAccess.assertInput(principal, branchId);

    const quantity = input.quantity ?? 1;
    const listPriceMinor = input.unitListPriceMinor ?? input.unitPriceMinor;
    const vatRate = input.vatRateBasisPoints ?? DEFAULT_VAT_BASIS_POINTS;

    ChargesService.assertOverrideAllowed(
      principal,
      listPriceMinor,
      input.unitPriceMinor,
      input.priceOverrideReason,
    );

    const row = await this.tx
      .run(async (tx) => {
        const discount =
          input.discountId === undefined
            ? undefined
            : await ChargesService.requireDiscount(tx, input.discountId);

        const amounts = computeChargeAmounts({
          quantity,
          unitPriceMinor: input.unitPriceMinor,
          vatRateBasisPoints: vatRate,
          ...(discount === undefined
            ? {}
            : { discount: { kind: discount.kind, value: discount.value } }),
        });

        return repo.insertCharge(tx, {
          tenantId: principal.tenantId,
          branchId,
          customerId: input.customerId,
          source: input.source,
          description: input.description,
          quantity,
          unitListPriceMinor: listPriceMinor,
          unitPriceMinor: input.unitPriceMinor,
          vatRateBasisPoints: vatRate,
          ...(discount === undefined
            ? {}
            : {
                discountId: discount.id,
                discountKind: discount.kind,
                discountValue: discount.value,
              }),
          ...amounts,
          ...(listPriceMinor === input.unitPriceMinor
            ? {}
            : {
                priceOverrideReason: input.priceOverrideReason ?? null,
                priceOverriddenBy: principal.userId,
              }),
          createdBy: principal.userId,
        });
      })
      .catch((error: unknown) => {
        throw ChargesService.translate(error);
      });

    return ChargesService.present(row);
  }

  async get(id: string): Promise<ChargeResponseDto> {
    const row = await this.tx.run((tx) => repo.findChargeById(tx, id));
    if (row === undefined) throw AppError.notFound('Ücret kalemi bulunamadı');
    return ChargesService.present(row);
  }

  async list(principal: Principal, query: ListChargesQueryDto): Promise<ChargePageDto> {
    if (query.branchId !== undefined) {
      await this.branchAccess.assertInput(principal, query.branchId);
    }
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run((tx) =>
      repo.listCharges(
        tx,
        {
          customerId: query.customerId,
          branchId: query.branchId,
          source: query.source,
          status: query.status,
          from: query.from === undefined ? undefined : new Date(query.from),
          to: query.to === undefined ? undefined : new Date(query.to),
        },
        { limit, cursor },
      ),
    );

    const page: Page<repo.ChargeRow> = toPage(rows, limit, (row) => ({
      sortKey: row.createdAt.toISOString(),
      id: row.id,
    }));

    return {
      data: page.data.map((row) => ChargesService.present(row)),
      pageInfo: page.pageInfo,
    };
  }

  /**
   * Kalemi düzeltir.
   *
   * `void` edilmiş kalem değiştirilemez (trigger `K0010`); düzeltme yeni kalem
   * açmakla yapılır. Tutar yeniden HESAPLANIR, istemciden alınmaz — istemcinin
   * gönderdiği bir toplam, aritmetiği sözleşmenin dışına çıkarırdı.
   */
  async update(
    principal: Principal,
    id: string,
    expectedVersion: number,
    input: UpdateChargeDto,
  ): Promise<ChargeResponseDto> {
    const row = await this.tx
      .run(async (tx) => {
        const current = await repo.lockChargeById(tx, id);
        if (current === undefined) return undefined;
        BranchAccessService.assertMembership(principal, current.branchId);

        if (current.status === 'void') {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'İptal edilmiş ücret kalemi düzeltilemez',
            { detail: 'Düzeltme için yeni bir kalem açın.' },
          );
        }
        if (current.source === 'package_refund') {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'İade kalemi elle düzeltilemez',
            { detail: 'İade tutarı satış anındaki tahsisten türetilir.' },
          );
        }

        const quantity = input.quantity ?? current.quantity;
        const unitPriceMinor = input.unitPriceMinor ?? current.unitPriceMinor;

        ChargesService.assertOverrideAllowed(
          principal,
          current.unitListPriceMinor,
          unitPriceMinor,
          input.priceOverrideReason ?? current.priceOverrideReason ?? undefined,
        );

        const discount =
          input.discountId === undefined
            ? current.discountId === null
              ? undefined
              : { kind: current.discountKind!, value: current.discountValue! }
            : input.discountId === null
              ? undefined
              : await ChargesService.requireDiscount(tx, input.discountId);

        const amounts = computeChargeAmounts({
          quantity,
          unitPriceMinor,
          vatRateBasisPoints: current.vatRateBasisPoints,
          ...(discount === undefined
            ? {}
            : { discount: { kind: discount.kind, value: discount.value } }),
        });

        const isOverride = unitPriceMinor !== current.unitListPriceMinor;

        return repo.updateChargeWithVersion(tx, id, expectedVersion, {
          description: input.description,
          quantity,
          unitPriceMinor,
          ...(input.discountId === undefined
            ? {}
            : input.discountId === null
              ? { discountId: null, discountKind: null, discountValue: null }
              : {
                  discountId: input.discountId,
                  discountKind: discount?.kind ?? null,
                  discountValue: discount?.value ?? null,
                }),
          ...amounts,
          priceOverrideReason: isOverride
            ? (input.priceOverrideReason ?? current.priceOverrideReason)
            : null,
          priceOverriddenBy: isOverride ? principal.userId : null,
        });
      })
      .catch((error: unknown) => {
        throw ChargesService.translate(error);
      });

    if (row === undefined) throw AppError.notFound('Ücret kalemi bulunamadı');
    return ChargesService.present(row);
  }

  /**
   * Kalemi iptal eder.
   *
   * Tahsilat yapılmış bir kalem iptal EDİLEMEZ: para girmiş bir borcu yok
   * saymak cari bakiyeyi alacaklı tarafa kaydırırdı. Böyle bir durumda önce
   * tahsilat iptal edilmeli, sonra kalem.
   */
  async void(
    principal: Principal,
    id: string,
    expectedVersion: number,
    reason: string,
  ): Promise<ChargeResponseDto> {
    const row = await this.tx
      .run(async (tx) => {
        const current = await repo.lockChargeById(tx, id);
        if (current === undefined) return undefined;
        BranchAccessService.assertMembership(principal, current.branchId);
        if (current.status === 'void') return current;

        const allocated = await repo.allocatedForCharge(tx, id);
        if (allocated > 0) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Tahsilat yapılmış ücret kalemi iptal edilemez',
            { detail: 'Önce ilgili tahsilatı iptal edin.' },
          );
        }

        return repo.updateChargeWithVersion(tx, id, expectedVersion, {
          status: 'void',
          voidedAt: new Date(),
          voidedBy: principal.userId,
          voidedReason: reason,
        });
      })
      .catch((error: unknown) => {
        throw ChargesService.translate(error);
      });

    if (row === undefined) throw AppError.notFound('Ücret kalemi bulunamadı');
    return ChargesService.present(row);
  }

  /**
   * Müşterinin cari hesabı.
   *
   * Bakiye HİÇBİR YERDE SAKLANMAZ; `customer_account_entries` view'ından
   * toplanır (bkz. `0027`). Saklanan bir bakiye, senkron tutulması gereken
   * üçüncü bir gerçek kaynağı olurdu.
   */
  async account(
    principal: Principal,
    customerId: string,
    query: ListAccountQueryDto,
  ): Promise<CustomerAccountDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(query.cursor);

    return this.tx.run(async (tx) => {
      const totals = await tx.execute<{
        charged_minor: string | null;
        paid_minor: string | null;
        currency: string | null;
      }>(sql`
        select
          coalesce(sum(amount_minor) filter (where entry_kind = 'charge'), 0)::bigint
            as charged_minor,
          coalesce(-sum(amount_minor) filter (where entry_kind = 'payment'), 0)::bigint
            as paid_minor,
          min(currency) as currency
        from customer_account_entries
        where customer_id = ${customerId}::uuid
      `);

      const rows = await tx.execute<{
        entry_id: string;
        entry_kind: 'charge' | 'payment';
        entry_source: string;
        description: string;
        amount_minor: string | number;
        currency: string;
        occurred_at: string;
      }>(sql`
        select entry_id, entry_kind, entry_source, description,
               amount_minor, currency, occurred_at
          from customer_account_entries
         where customer_id = ${customerId}::uuid
           and (${cursor?.sortKey ?? null}::timestamptz is null
                or (occurred_at, entry_id)
                     < (${cursor?.sortKey ?? null}::timestamptz,
                        ${cursor?.id ?? null}::uuid))
         order by occurred_at desc, entry_id desc
         limit ${limit + 1}
      `);

      // ⚠️ Ham SQL'de `occurred_at` STRING gelir — sürücü yalnız Drizzle
      // şeması üzerinden okunan kolonları Date'e çevirir. `toISOString()`
      // doğrudan çağrılırsa 500 olur (gözlendi).
      const page = toPage(rows.rows, limit, (row) => ({
        sortKey: new Date(row.occurred_at).toISOString(),
        id: row.entry_id,
      }));

      const summary = totals.rows[0];
      const chargedMinor = Number(summary?.charged_minor ?? 0);
      const paidMinor = Number(summary?.paid_minor ?? 0);

      const entries: AccountEntryDto[] = page.data.map((row) => ({
        entryId: row.entry_id,
        entryKind: row.entry_kind,
        entrySource: row.entry_source,
        description: row.description,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        occurredAt: new Date(row.occurred_at).toISOString(),
      }));

      // Kiracı tek para birimi kullanır (Faz 6 kapsamı); `min()` yalnız
      // "hiç kayıt yoksa" durumunu boş bırakmamak için.
      const currency = summary?.currency ?? 'TRY';

      void principal;
      return {
        customerId,
        chargedMinor,
        paidMinor,
        balanceMinor: chargedMinor - paidMinor,
        currency,
        entries,
        pageInfo: page.pageInfo,
      };
    });
  }

  /**
   * Katalog fiyatının dışına çıkmak AYRI bir izindir.
   *
   * Gerekçe `package:refund` (0025) ile birebir aynı: resepsiyonun günlük
   * tahsilat iznine binen bir fiyat override'ı, yetkisiz indirim demektir.
   * Gerekçe zorunluluğu ayrıca DB constraint'inde de var — burada erken ve
   * anlamlı bir hata için kontrol ediliyor.
   */
  private static assertOverrideAllowed(
    principal: Principal,
    listPriceMinor: number,
    unitPriceMinor: number,
    reason: string | undefined,
  ): void {
    if (listPriceMinor === unitPriceMinor) return;

    if (!hasPermission(principal, PERMISSIONS.FINANCE_PRICE_OVERRIDE)) {
      throw AppError.forbidden('Fiyat değişikliği için yetkiniz yok', {
        detail: `Gereken izin: ${PERMISSIONS.FINANCE_PRICE_OVERRIDE}`,
      });
    }
    if (reason === undefined || reason.trim().length < 5) {
      throw new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Fiyat değişikliği için gerekçe zorunlu',
        { detail: 'En az 5 karakterlik bir gerekçe girin.' },
      );
    }
  }

  private static async requireDiscount(
    tx: Parameters<typeof repo.findDiscountById>[0],
    id: string,
  ): Promise<repo.DiscountRow> {
    const discount = await repo.findDiscountById(tx, id);
    if (discount === undefined) throw AppError.notFound('İndirim bulunamadı');
    return discount;
  }

  static present(row: repo.ChargeRow): ChargeResponseDto {
    return {
      id: row.id,
      branchId: row.branchId,
      customerId: row.customerId,
      source: row.source,
      appointmentServiceId: row.appointmentServiceId,
      customerPackageId: row.customerPackageId,
      description: row.description,
      quantity: row.quantity,
      unitListPriceMinor: row.unitListPriceMinor,
      unitPriceMinor: row.unitPriceMinor,
      discountId: row.discountId,
      discountKind: row.discountKind,
      discountValue: row.discountValue,
      discountMinor: row.discountMinor,
      vatRateBasisPoints: row.vatRateBasisPoints,
      totalMinor: row.totalMinor,
      netMinor: row.netMinor,
      vatMinor: row.vatMinor,
      currency: row.currency,
      status: row.status,
      priceOverrideReason: row.priceOverrideReason,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidedReason: row.voidedReason,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  }

  static versionConflict(): AppError {
    return versionConflict();
  }

  /** Ücret kalemi kaynaklı DB hatalarının istemci karşılıkları. */
  static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.DISCOUNT_INVALID)) {
      return AppError.conflict(ERROR_CODES.DISCOUNT_INVALID, 'İndirim uygulanamaz', {
        detail: 'İndirim pasif, süresi dolmuş ya da kullanım hakkı tükenmiş.',
      });
    }
    if (isPgError(error, PG_ERROR.CHARGE_NOT_OPEN)) {
      return AppError.conflict(
        ERROR_CODES.CONFLICT,
        'İptal edilmiş ücret kalemi değiştirilemez',
      );
    }
    if (isPgError(error, PG_ERROR.PACKAGE_BINDING_INVALID)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Ücret kalemi kaynağıyla uyuşmuyor',
        { detail: 'Kalem, randevunun ya da paketin müşterisine yazılmalıdır.' },
      );
    }
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      const constraint = pgConstraintName(error);
      if (constraint === 'charges_appointment_service_once') {
        return AppError.conflict(
          ERROR_CODES.CONFLICT,
          'Bu randevu kalemi için zaten açık bir ücret kalemi var',
        );
      }
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Kayıt zaten mevcut');
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Ücret kalemi geçersiz');
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return new AppError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Müşteri, şube ya da indirim bulunamadı',
      );
    }
    return error;
  }
}
