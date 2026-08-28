import { Injectable } from '@nestjs/common';
import { TenantTxService } from '../../database/tenant-tx.service';
import { AppError } from '../../common/errors/app-error';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import type { NotificationChannel } from '../../database/schema';
import type { Principal } from '../identity/principal';
import * as repo from './notifications.repository';
import type { CreateOptOutDto, OptOutResponseDto } from './dto/notification.dto';

/**
 * İleti reddi (opt-out).
 *
 * Kayıt SİLİNMEZ; geri alma `revoked_at` doldurur. Ticari ileti mevzuatında
 * "müşteri ne zaman reddetti, ne zaman geri aldı" bir kanıt sorusudur ve
 * silinen satır o soruyu cevapsız bırakırdı.
 */
@Injectable()
export class OptOutsService {
  constructor(private readonly tx: TenantTxService) {}

  async create(
    principal: Principal,
    customerId: string,
    input: CreateOptOutDto,
  ): Promise<OptOutResponseDto> {
    const row = await this.tx
      .run(async (tx) => {
        const customer = await repo.findCustomerContact(tx, customerId);
        if (customer === undefined) return undefined;

        return repo.insertOptOut(tx, {
          tenantId: this.tx.tenantId,
          customerId,
          channel: input.channel ?? null,
          kind: 'marketing',
          source: input.source ?? 'customer_request',
          note: input.note ?? null,
          createdBy: principal.userId,
        });
      })
      .catch((error: unknown) => {
        // Aynı kapsamda ikinci kez reddetmek bir hata değil, aynı sonucu
        // isteyen bir tekrar. Kısmi tekil indeks bunu yakalıyor.
        if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) return 'duplicate' as const;
        throw error;
      });

    if (row === undefined) throw AppError.notFound('Müşteri bulunamadı');
    if (row === 'duplicate') {
      const existing = await this.tx.run((tx) => repo.listActiveOptOuts(tx, customerId));
      const match = existing.find((item) => item.channel === (input.channel ?? null));
      if (match !== undefined) return OptOutsService.toResponse(match);
      throw AppError.conflict('CONFLICT', 'İleti reddi kaydı zaten var');
    }

    return OptOutsService.toResponse(row);
  }

  async revoke(
    principal: Principal,
    customerId: string,
    channel: NotificationChannel | undefined,
  ): Promise<void> {
    await this.tx.run((tx) =>
      repo.revokeOptOuts(tx, {
        customerId,
        channel: channel ?? null,
        actorUserId: principal.userId,
      }),
    );
  }

  async list(customerId: string): Promise<OptOutResponseDto[]> {
    const rows = await this.tx.run((tx) => repo.listActiveOptOuts(tx, customerId));
    return rows.map((row) => OptOutsService.toResponse(row));
  }

  private static toResponse(row: repo.ContactOptOutRow): OptOutResponseDto {
    return {
      id: row.id,
      customerId: row.customerId,
      channel: row.channel,
      kind: row.kind,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
