import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import { maskPhone } from '../../observability/redaction';
import type { Principal } from '../identity/principal';
import * as repo from './webhook.repository';
import type { InboxItemDto, ListInboxQueryDto } from './dto/webhook.dto';

@Injectable()
export class InboxService {
  constructor(private readonly tx: TenantTxService) {}

  async list(query: ListInboxQueryDto): Promise<InboxItemDto[]> {
    const rows = await this.tx.run((tx) =>
      repo.listInbox(tx, {
        limit: query.limit ?? 50,
        onlyUnhandled: query.onlyUnhandled ?? true,
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      // Numara MASKELİ döner; müşteri kaydı varsa kimliği zaten `customerId`de.
      from: maskPhone(row.fromPhone),
      messageType: row.messageType,
      body: row.body,
      receivedAt: row.receivedAt.toISOString(),
      handledAt: row.handledAt?.toISOString() ?? null,
    }));
  }

  async markHandled(principal: Principal, id: string): Promise<void> {
    const found = await this.tx.run((tx) => repo.markInboundHandled(tx, id, principal.userId));
    if (!found) throw AppError.notFound('Mesaj bulunamadı');
  }
}
