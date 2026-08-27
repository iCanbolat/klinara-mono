import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { normalizePhone } from '../../common/phone';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as repo from './crm.repository';
import type {
  CreateCustomerDto,
  CustomerResponseDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

@Injectable()
export class CrmService {
  constructor(private readonly tx: TenantTxService) {}

  async listCustomers(): Promise<CustomerResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listCustomers(tx));
    return rows.map((row) => CrmService.toResponse(row));
  }

  async getCustomer(id: string): Promise<CustomerResponseDto> {
    const row = await this.tx.run((tx) => repo.findCustomerById(tx, id));
    if (row === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(row);
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
        }),
      )
      .catch((error: unknown) => {
        throw CrmService.translate(error);
      });

    return CrmService.toResponse(row);
  }

  async updateCustomer(id: string, input: UpdateCustomerDto): Promise<CustomerResponseDto> {
    // `null` "temizle", `undefined` "dokunma" demektir; ikisi ayrı ayrı taşınır.
    const phone =
      input.phone === undefined
        ? undefined
        : input.phone === null
          ? null
          : CrmService.normalizeOptionalPhone(input.phone);

    const row = await this.tx
      .run((tx) =>
        repo.updateCustomer(tx, id, {
          fullName: input.fullName?.trim(),
          phone,
          email: input.email,
          birthDate: input.birthDate,
          gender: input.gender,
          notes: input.notes,
        }),
      )
      .catch((error: unknown) => {
        throw CrmService.translate(error);
      });

    if (row === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(row);
  }

  async deleteCustomer(id: string): Promise<CustomerResponseDto> {
    const row = await this.tx.run((tx) => repo.softDeleteCustomer(tx, id));
    if (row === undefined) throw AppError.notFound('Müşteri bulunamadı');
    return CrmService.toResponse(row);
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

  private static toResponse(row: repo.CustomerRow): CustomerResponseDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      birthDate: row.birthDate,
      gender: row.gender,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
