import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { DEFAULT_PAGE_SIZE, decodeCursor, MAX_PAGE_SIZE, toPage, type Page } from '../../common/pagination';
import { normalizePhone } from '../../common/phone';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import type { Principal } from '../identity/principal';
import * as repo from './crm.repository';
import type {
  CreateCustomerDto,
  CustomerMergeResponseDto,
  CustomerResponseDto,
  CustomerTagInputDto,
  CustomerTagResponseDto,
  ListCustomersQueryDto,
  SearchCustomersQueryDto,
  UpdateCustomerDto,
  UpdateCustomerTagDto,
} from './dto/customer.dto';

const SEARCH_DEFAULT_LIMIT = 20;

@Injectable()
export class CrmService {
  constructor(private readonly tx: TenantTxService) {}

  async listCustomers(query: ListCustomersQueryDto): Promise<Page<CustomerResponseDto>> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);

    const { rows, tags } = await this.tx.run(async (tx) => {
      // `limit + 1` satır: "daha var mı?" sorusu ikinci bir COUNT olmadan
      // cevaplanıyor.
      const found = await repo.listCustomers(tx, {
        limit: limit + 1,
        cursorCreatedAt: cursor?.sortKey,
        cursorId: cursor?.id,
        tagId: query.tagId,
        source: query.source,
      });
      return { rows: found, tags: await repo.listTagsForCustomers(tx, found.map((r) => r.id)) };
    });

    const page = toPage(rows, limit, repo.listCustomersOrderKey);
    return {
      data: page.data.map((row) => CrmService.toResponse(row, tags.get(row.id) ?? [])),
      pageInfo: page.pageInfo,
    };
  }

  async searchCustomers(query: SearchCustomersQueryDto): Promise<CustomerResponseDto[]> {
    const folded = CrmService.foldQuery(query.q);
    const limit = query.limit ?? SEARCH_DEFAULT_LIMIT;

    const { rows, tags } = await this.tx.run(async (tx) => {
      const found = await repo.searchCustomers(tx, { folded, limit });
      return { rows: found, tags: await repo.listTagsForCustomers(tx, found.map((r) => r.id)) };
    });

    return rows.map((row) => CrmService.toResponse(row, tags.get(row.id) ?? []));
  }

  async getCustomer(id: string): Promise<CustomerResponseDto> {
    const payload = await this.tx.run(async (tx) => {
      const row = await repo.findCustomerById(tx, id);
      if (row === undefined) return undefined;
      return { row, tags: await repo.listTagsForCustomers(tx, [id]) };
    });
    if (payload === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(payload.row, payload.tags.get(id) ?? []);
  }

  async createCustomer(input: CreateCustomerDto): Promise<CustomerResponseDto> {
    const phone = CrmService.normalizeOptionalPhone(input.phone);

    const row = await this.tx
      .run((tx) =>
        repo.insertCustomer(tx, {
          tenantId: this.tx.tenantId,
          fullName: input.fullName.trim(),
          phone,
          email: input.email,
          birthDate: input.birthDate,
          gender: input.gender,
          notes: input.notes,
          addressLine: input.addressLine,
          district: input.district,
          city: input.city,
          postalCode: input.postalCode,
          source: input.source,
        }),
      )
      .catch((error: unknown) => {
        throw CrmService.translate(error);
      });

    return CrmService.toResponse(row, []);
  }

  async updateCustomer(id: string, input: UpdateCustomerDto): Promise<CustomerResponseDto> {
    // `null` "temizle", `undefined` "dokunma" demektir; ikisi ayrı ayrı taşınır.
    const phone =
      input.phone === undefined
        ? undefined
        : input.phone === null
          ? null
          : CrmService.normalizeOptionalPhone(input.phone);

    const payload = await this.tx
      .run(async (tx) => {
        const row = await repo.updateCustomer(tx, id, {
          fullName: input.fullName?.trim(),
          phone,
          email: input.email,
          birthDate: input.birthDate,
          gender: input.gender,
          notes: input.notes,
          addressLine: input.addressLine,
          district: input.district,
          city: input.city,
          postalCode: input.postalCode,
          source: input.source,
        });
        if (row === undefined) return undefined;
        return { row, tags: await repo.listTagsForCustomers(tx, [id]) };
      })
      .catch((error: unknown) => {
        throw CrmService.translate(error);
      });

    if (payload === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(payload.row, payload.tags.get(id) ?? []);
  }

  async deleteCustomer(id: string): Promise<CustomerResponseDto> {
    const row = await this.tx.run((tx) => repo.softDeleteCustomer(tx, id));
    if (row === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(row, []);
  }

  // ---------------------------------------------------------------------------
  // Etiketler
  // ---------------------------------------------------------------------------

  async listTags(): Promise<CustomerTagResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listTags(tx));
    return rows.map((row) => CrmService.toTagResponse(row));
  }

  async createTag(input: CustomerTagInputDto): Promise<CustomerTagResponseDto> {
    const row = await this.tx
      .run((tx) =>
        repo.insertTag(tx, {
          tenantId: this.tx.tenantId,
          name: input.name.trim(),
          color: input.color,
        }),
      )
      .catch((error: unknown) => {
        throw CrmService.translateTag(error);
      });
    return CrmService.toTagResponse(row);
  }

  async updateTag(id: string, input: UpdateCustomerTagDto): Promise<CustomerTagResponseDto> {
    const row = await this.tx
      .run((tx) => repo.updateTag(tx, id, { name: input.name?.trim(), color: input.color }))
      .catch((error: unknown) => {
        throw CrmService.translateTag(error);
      });
    if (row === undefined) throw AppError.notFound('Etiket bulunamadı');
    return CrmService.toTagResponse(row);
  }

  async deleteTag(id: string): Promise<void> {
    const deleted = await this.tx.run((tx) => repo.deleteTag(tx, id));
    if (!deleted) throw AppError.notFound('Etiket bulunamadı');
  }

  async replaceCustomerTags(id: string, tagIds: string[]): Promise<CustomerResponseDto> {
    const unique = [...new Set(tagIds)];

    const payload = await this.tx
      .run(async (tx) => {
        const customer = await repo.findCustomerById(tx, id);
        if (customer === undefined) return undefined;
        await repo.replaceCustomerTags(tx, this.tx.tenantId, id, unique);
        return { row: customer, tags: await repo.listTagsForCustomers(tx, [id]) };
      })
      .catch((error: unknown) => {
        throw CrmService.translateTag(error);
      });

    if (payload === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(payload.row, payload.tags.get(id) ?? []);
  }

  // ---------------------------------------------------------------------------
  // Birleştirme
  // ---------------------------------------------------------------------------

  /**
   * Mükerrer kaydı hayatta kalan kayda birleştirir.
   *
   * Sıra önemli: önce satırlar taşınır, sonra hedefin BOŞ alanları kaynaktan
   * doldurulur, en son kaynak arşivlenir. Hepsi tek transaction'da — yarıda
   * kalan bir birleştirme, randevuları bir kartta tahsilatları başka kartta
   * duran bir müşteri demek olurdu.
   */
  async mergeCustomer(
    principal: Principal,
    targetId: string,
    sourceId: string,
  ): Promise<CustomerMergeResponseDto> {
    if (targetId === sourceId) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Bir kayıt kendisiyle birleştirilemez');
    }

    const payload = await this.tx
      .run(async (tx) => {
        const target = await repo.findCustomerById(tx, targetId);
        if (target === undefined) throw AppError.notFound('Hayatta kalacak müşteri bulunamadı');
        const source = await repo.findCustomerById(tx, sourceId);
        if (source === undefined) throw AppError.notFound('Birleştirilecek müşteri bulunamadı');

        const moved = await repo.moveCustomerRows(tx, sourceId, targetId);

        // Hedefin DOLU alanı ezilmez: birleştirme veri kazanmaktır, kaybetmek
        // değil. Telefon da taşınmaz — hedefin numarası yoksa bile kaynağınki
        // tekillik indeksinde hâlâ ona ait; arşivlenme sırası bunu çözmez.
        const filled = await CrmService.fillEmptyFields(tx, target, source);

        await repo.archiveMergedCustomer(tx, sourceId, targetId);

        const merge = await repo.insertMerge(tx, {
          tenantId: this.tx.tenantId,
          sourceCustomerId: sourceId,
          targetCustomerId: targetId,
          actorUserId: principal.userId,
          moved,
        });

        return { merge, customer: filled, tags: await repo.listTagsForCustomers(tx, [targetId]) };
      })
      .catch((error: unknown) => {
        // Aynı müşterinin ÇAKIŞAN randevuları: `customer_bookings` üzerindeki
        // EXCLUDE constraint'i taşımayı reddeder. Sessizce yutulamaz — iki
        // kayıt gerçekten aynı anda iki randevuda görünüyor demektir.
        if (isPgError(error, PG_ERROR.EXCLUSION_VIOLATION)) {
          throw AppError.conflict(
            ERROR_CODES.CONFLICT,
            'Bu iki kartın çakışan randevuları var',
            {
              detail:
                'Aynı saatte iki randevu tek müşteriye bağlanamaz. Çakışan randevulardan biri iptal edilip birleştirme yeniden denenmeli.',
            },
          );
        }
        throw CrmService.translate(error);
      });

    return {
      id: payload.merge.id,
      sourceCustomerId: sourceId,
      targetCustomerId: targetId,
      moved: payload.merge.moved,
      customer: CrmService.toResponse(payload.customer, payload.tags.get(targetId) ?? []),
    };
  }

  private static async fillEmptyFields(
    tx: Tx,
    target: repo.CustomerRow,
    source: repo.CustomerRow,
  ): Promise<repo.CustomerRow> {
    const patch: Record<string, string | null> = {};
    const fields = [
      'email',
      'birthDate',
      'gender',
      'addressLine',
      'district',
      'city',
      'postalCode',
      'source',
    ] as const;

    for (const field of fields) {
      if (target[field] == null && source[field] != null) patch[field] = source[field];
    }

    // Notlar birleştirilir, ezilmez: ikisi de gerçek bilgi taşıyor olabilir.
    if (source.notes != null && source.notes.trim().length > 0) {
      patch.notes =
        target.notes == null || target.notes.trim().length === 0
          ? source.notes
          : `${target.notes}\n\n— Birleştirilen kayıttan:\n${source.notes}`;
    }

    if (Object.keys(patch).length === 0) return target;
    const updated = await repo.updateCustomer(tx, target.id, patch);
    return updated ?? target;
  }

  /**
   * Arama metnini veritabanındakiyle AYNI kurala göre katlar.
   *
   * Telefon araması için ek bir adım var: kullanıcı `0532 123 45 67` yazar ama
   * kayıt `+905321234567` durur. Rakamlara indirip baştaki `0`/`90`yı atmak,
   * yazılan numarayı saklanan numaranın bir ALT DİZİSİ hâline getiriyor —
   * böylece tek `like` predicate'i hem adı hem telefonu buluyor.
   */
  private static foldQuery(raw: string): string {
    const trimmed = raw.trim();
    if (/^[0-9+()\-\s]+$/.test(trimmed)) {
      const digits = trimmed.replace(/\D/g, '').replace(/^0+/, '').replace(/^90/, '');
      if (digits.length > 0) return digits;
    }
    return trimmed
      .toLocaleLowerCase('tr-TR')
      .replace(/[İIı]/g, 'i')
      .replace(/[Şş]/g, 's')
      .replace(/[Ğğ]/g, 'g')
      .replace(/[Üü]/g, 'u')
      .replace(/[Öö]/g, 'o')
      .replace(/[Çç]/g, 'c');
  }

  /**
   * Numarayı E.164'e çevirir; geçersizse isteği reddeder.
   *
   * Ham metni saklamak seçenek değil: numara müşteri kartını bulmanın birincil
   * yolu ve tekillik indeksinin anahtarı. `0532…` ile `+90532…` aynı kişidir.
   */
  private static normalizeOptionalPhone(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;

    const normalized = normalizePhone(trimmed);
    if (normalized === null) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Telefon numarası geçersiz', {
        // İstemci alan bazlı hatayı `errors` üzerinden okur (bkz. Ek D, #3).
        extra: { errors: [{ path: 'phone', message: 'Geçerli bir telefon numarası girin' }] },
      });
    }
    return normalized;
  }

  private static translate(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(
        ERROR_CODES.CONFLICT,
        'Bu telefon numarası başka bir müşteri kartında kayıtlı',
      );
    }
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Müşteri bilgileri geçersiz');
    }
    return error;
  }

  private static translateTag(error: unknown): unknown {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Bu etiket adı zaten kullanımda');
    }
    if (isPgError(error, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
      return AppError.notFound('Etiket bulunamadı');
    }
    // Kapsam trigger'ı: FK doğrulaması RLS'i bypass ettiği için BAŞKA bir
    // kiracının etiket kimliği FK'dan geçer, kurala trigger'da takılır.
    if (isPgError(error, PG_ERROR.CHECK_VIOLATION)) {
      return AppError.conflict(ERROR_CODES.CONFLICT, 'Etiket bu kiracıya ait olmalı');
    }
    return error;
  }

  private static toTagResponse(row: repo.CustomerTagRow): CustomerTagResponseDto {
    return { id: row.id, name: row.name, color: row.color };
  }

  private static toResponse(
    row: repo.CustomerRow,
    tags: repo.CustomerTagRow[],
  ): CustomerResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      birthDate: row.birthDate,
      gender: row.gender,
      notes: row.notes,
      addressLine: row.addressLine,
      district: row.district,
      city: row.city,
      postalCode: row.postalCode,
      source: row.source,
      mergedIntoCustomerId: row.mergedIntoCustomerId,
      tags: tags.map((tag) => CrmService.toTagResponse(tag)),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
