import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  toPage,
  type Page,
} from '../../common/pagination';
import { TenantTxService } from '../../database/tenant-tx.service';
import * as repo from './notifications.repository';
import type { ListMessagesQueryDto, MessageResponseDto } from './dto/notification.dto';

/**
 * Mesaj kaydı okuma.
 *
 * Yanıtta ham adres YOKTUR (`to` maskelidir) — kolon zaten maskeli saklanıyor,
 * yani sızdırmak isteyen bir uç bile sızdıramaz.
 */
@Injectable()
export class MessagesService {
  constructor(private readonly tx: TenantTxService) {}

  async list(query: ListMessagesQueryDto): Promise<Page<MessageResponseDto>> {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(query.cursor);

    const rows = await this.tx.run((tx) =>
      repo.listMessages(tx, {
        limit: limit + 1,
        cursorCreatedAt: cursor?.sortKey,
        cursorId: cursor?.id,
        customerId: query.customerId,
        channel: query.channel,
        event: query.event,
        status: query.status,
        from: query.from,
        to: query.to,
      }),
    );

    const page = toPage(rows, limit, repo.listMessagesOrderKey);
    return {
      data: page.data.map((row) => MessagesService.toResponse(row)),
      pageInfo: page.pageInfo,
    };
  }

  static toResponse(this: void, row: repo.MessageLogRow): MessageResponseDto {
    return {
      id: row.id,
      customerId: row.customerId,
      userId: row.userId,
      channel: row.channel,
      event: row.event,
      status: row.status,
      to: row.toMasked,
      subject: row.renderedSubject,
      body: row.renderedBody,
      errorCode: row.errorCode,
      attempt: row.attempt,
      scheduledFor: row.scheduledFor.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
