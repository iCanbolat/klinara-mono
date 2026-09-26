import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { AppError } from '../../common/errors/app-error';
import { TenantTxService } from '../../database/tenant-tx.service';
import type { Tx } from '../../database/tenant-tx';
import { maskPhone } from '../../observability/redaction';
import type { Principal } from '../identity/principal';
import { appointmentVariables } from '../notifications/appointment-notifier.service';
import * as notificationsRepo from '../notifications/notifications.repository';
import * as remindersRepo from '../notifications/reminders.repository';
import { PermanentSendError, TransientSendError } from '../notifications/send-errors';
import * as repo from './conversations.repository';
import * as whatsappRepo from './whatsapp.repository';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import {
  positionalBody,
  STANDARD_TEMPLATE_BY_NAME,
} from './whatsapp-standard-templates';
import type {
  ConversationDetailDto,
  ConversationDto,
  ConversationMessageDto,
  ConversationPageDto,
  ConversationTemplateOptionDto,
  ListConversationsQueryDto,
  SendConversationTemplateDto,
} from './dto/conversation.dto';

/** Meta'nın müşteri hizmetleri penceresi. */
const WINDOW_MS = 24 * 60 * 60 * 1000;
const THREAD_LIMIT = 200;
/**
 * Sohbetten gönderilebilen şablon kategorileri: yalnız işlemsel. OTP
 * (AUTHENTICATION) sohbetin işi değil; pazarlama şablonu ürünün kapsamı dışında —
 * klinik Meta'da açmış olsa da listede görünmez ve gönderilemez.
 */
const SENDABLE_CATEGORIES = new Set(['UTILITY']);

type TemplateRow = Awaited<ReturnType<typeof whatsappRepo.listTemplates>>[number];

/**
 * Resepsiyonun WhatsApp sohbetleri.
 *
 * Elle yazılan cevap KUYRUKTAN GEÇMEZ: resepsiyon "gönder"e bastığında
 * mesajın gidip gitmediğini o anda görmeli. Kuyruğun getirdiği iki şey
 * (sessiz saat ertelemesi, yeniden deneme) burada istenmiyor — müşteri az
 * önce yazdı ve cevap bekliyor; geçici bir hatada resepsiyon yeniden gönderir.
 *
 * Kayıt yine de `message_log`a düşer: "müşteriye kim, ne yazdı?" sorusunun
 * cevabı otomatik bildirimlerle aynı yerde durmalı ve teslim durumu (webhook)
 * aynı yoldan güncellenmeli.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly tx: TenantTxService,
    private readonly sender: WhatsAppSenderService,
  ) {}

  async list(query: ListConversationsQueryDto): Promise<ConversationPageDto> {
    const limit = query.limit ?? 50;
    const cursor = query.cursor === undefined ? undefined : ConversationsService.decodeCursor(query.cursor);
    const rows = await this.tx.run((tx) =>
      repo.list(tx, {
        status: query.status ?? 'open',
        unreadOnly: query.unreadOnly ?? false,
        // Bir fazlası: sonraki sayfa var mı?
        limit: limit + 1,
        cursor,
      }),
    );

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const hasMore = rows.length > limit && last !== undefined;
    return {
      data: page.map((row) => ConversationsService.toDto(row)),
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? ConversationsService.encodeCursor(last) : null,
      },
    };
  }

  async unreadCount(): Promise<number> {
    return this.tx.run((tx) => repo.countUnread(tx));
  }

  async get(id: string): Promise<ConversationDetailDto> {
    return this.tx.run(async (tx) => {
      const conversation = await repo.findById(tx, id);
      if (conversation === undefined) throw AppError.notFound('Sohbet bulunamadı');
      const messages = await repo.thread(tx, conversation, THREAD_LIMIT);
      return {
        conversation: ConversationsService.toDto(conversation),
        messages: messages.map((row) => ConversationsService.toMessageDto(row)),
      };
    });
  }

  /**
   * Serbest metin cevap.
   *
   * Pencere kapalıysa HİÇ DENENMEZ: Meta zaten reddederdi ve kayıtta bir
   * `failed` satırı bırakmak, resepsiyona "bir şey denendi" izlenimi verirdi.
   * Gönderim hatası ise `failed` satırı olarak DÖNER — hata fırlatılmıyor ki
   * arayüz balonu kırmızı çizip sebebini gösterebilsin.
   */
  async send(principal: Principal, id: string, rawBody: string): Promise<ConversationMessageDto> {
    const body = rawBody.trim();
    if (body.length === 0) {
      throw new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Mesaj boş olamaz');
    }

    const tenantId = this.tx.tenantId;
    const now = new Date();
    const prepared = await this.tx.run(async (tx) => {
      const conversation = await repo.findById(tx, id);
      if (conversation === undefined) throw AppError.notFound('Sohbet bulunamadı');
      if (!ConversationsService.windowOpen(conversation, now)) {
        throw new AppError(
          422,
          ERROR_CODES.WHATSAPP_WINDOW_CLOSED,
          'Müşterinin son mesajının üzerinden 24 saat geçti; WhatsApp yalnız onaylı şablon gönderimine izin veriyor',
        );
      }

      const message = await notificationsRepo.insertMessage(tx, {
        tenantId,
        customerId: conversation.customerId,
        channel: 'whatsapp',
        event: 'staff_reply',
        status: 'sending',
        toMasked: maskPhone(conversation.phone),
        renderedBody: body,
        templateVariables: { message: body },
        scheduledFor: now,
        attempt: 1,
        conversationId: conversation.id,
        sentByUserId: principal.userId,
      });
      await repo.touchOutbound(tx, conversation.id, { at: now, preview: repo.previewOf(body, '') });
      return { conversation, messageId: message.id };
    });

    let update: Parameters<typeof notificationsRepo.updateMessage>[2];
    try {
      const result = await this.sender.send(tenantId, { to: prepared.conversation.phone, body });
      update = {
        status: 'sent',
        sentAt: new Date(),
        provider: 'whatsapp',
        providerMessageId: result.messageId,
      };
    } catch (error) {
      if (!(error instanceof PermanentSendError) && !(error instanceof TransientSendError)) {
        throw error;
      }
      update = {
        status: 'failed',
        failedAt: new Date(),
        provider: 'whatsapp',
        errorCode: error.code,
        errorDetail: error.message,
      };
    }

    await this.tx.run((tx) => notificationsRepo.updateMessage(tx, prepared.messageId, update));

    return {
      id: prepared.messageId,
      direction: 'out',
      type: 'text',
      body,
      createdAt: now.toISOString(),
      status: update.status ?? 'sent',
      event: 'staff_reply',
      sentByName: principal.fullName,
      errorDetail: update.errorDetail ?? null,
      appointmentId: null,
    };
  }

  /**
   * Pencere kapalıyken sohbete gönderilebilecek şablonlar.
   *
   * Butonlu şablonlar listede YOK: hızlı yanıt butonları bir randevuya bağlı
   * token taşır (hatırlatma) ve elle gönderimde o bağlam yok.
   */
  async templateOptions(id: string): Promise<ConversationTemplateOptionDto[]> {
    return this.tx.run(async (tx) => {
      const conversation = await repo.findById(tx, id);
      if (conversation === undefined) throw AppError.notFound('Sohbet bulunamadı');

      const templates = (await whatsappRepo.listTemplates(tx)).filter((row) =>
        ConversationsService.sendable(row),
      );
      if (templates.length === 0) return [];

      const suggestions = await this.suggestions(tx, conversation);
      return templates
        .map((row) => ConversationsService.toOption(row, suggestions))
        .filter((option): option is ConversationTemplateOptionDto => option !== null)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    });
  }

  /**
   * Onaylı şablon gönderimi — 24 saatlik pencereden BAĞIMSIZ.
   *
   * Kayıt, serbest cevapla aynı yoldan (`staff_reply`) düşer; akışta şablon
   * olarak görünmesi `templateVariables.templateName` anahtarından okunur.
   */
  async sendTemplate(
    principal: Principal,
    id: string,
    input: SendConversationTemplateDto,
  ): Promise<ConversationMessageDto> {
    const parameters = input.parameters.map((value) => value.trim());
    const tenantId = this.tx.tenantId;
    const now = new Date();

    const prepared = await this.tx.run(async (tx) => {
      const conversation = await repo.findById(tx, id);
      if (conversation === undefined) throw AppError.notFound('Sohbet bulunamadı');

      const template = (await whatsappRepo.listTemplates(tx)).find(
        (row) => row.name === input.templateName && row.language === input.language,
      );
      if (template === undefined || !ConversationsService.sendable(template)) {
        throw new AppError(
          422,
          ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
          'Bu şablon sohbetten gönderilemez: onaylı, butonsuz bir UTILITY şablonu seçin',
        );
      }
      if (
        parameters.length !== template.bodyVariableCount ||
        parameters.some((value) => value.length === 0)
      ) {
        throw new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Şablon parametreleri eksik', {
          extra: {
            errors: [
              {
                path: 'parameters',
                message: `Şablon ${template.bodyVariableCount} dolu parametre bekliyor`,
              },
            ],
          },
        });
      }

      const body = ConversationsService.render(
        ConversationsService.bodyOf(template) ?? '',
        parameters,
      );
      const message = await notificationsRepo.insertMessage(tx, {
        tenantId,
        customerId: conversation.customerId,
        channel: 'whatsapp',
        event: 'staff_reply',
        status: 'sending',
        toMasked: maskPhone(conversation.phone),
        renderedBody: body,
        templateVariables: {
          templateName: template.name,
          templateLanguage: template.language,
          ...Object.fromEntries(parameters.map((value, index) => [String(index + 1), value])),
        },
        scheduledFor: now,
        attempt: 1,
        conversationId: conversation.id,
        sentByUserId: principal.userId,
      });
      await repo.touchOutbound(tx, conversation.id, { at: now, preview: repo.previewOf(body, '') });
      return { conversation, template, body, messageId: message.id };
    });

    let update: Parameters<typeof notificationsRepo.updateMessage>[2];
    try {
      const result = await this.sender.send(tenantId, {
        to: prepared.conversation.phone,
        body: prepared.body,
        templateName: prepared.template.name,
        templateLanguage: prepared.template.language,
        parameters,
      });
      update = {
        status: 'sent',
        sentAt: new Date(),
        provider: 'whatsapp',
        providerMessageId: result.messageId,
      };
    } catch (error) {
      if (!(error instanceof PermanentSendError) && !(error instanceof TransientSendError)) {
        throw error;
      }
      update = {
        status: 'failed',
        failedAt: new Date(),
        provider: 'whatsapp',
        errorCode: error.code,
        errorDetail: error.message,
      };
    }

    await this.tx.run((tx) => notificationsRepo.updateMessage(tx, prepared.messageId, update));

    return {
      id: prepared.messageId,
      direction: 'out',
      type: 'template',
      body: prepared.body,
      createdAt: now.toISOString(),
      status: update.status ?? 'sent',
      event: 'staff_reply',
      sentByName: principal.fullName,
      errorDetail: update.errorDetail ?? null,
      appointmentId: null,
    };
  }

  /** Değişken adına göre önerilen değerler (müşteri, şube, en yakın randevu). */
  private async suggestions(
    tx: Tx,
    conversation: repo.ConversationRow,
  ): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    if (conversation.customerName !== null) values['customerName'] = conversation.customerName;
    const branchName = await repo.suggestedBranchName(tx, conversation.customerId);
    if (branchName !== undefined) values['branchName'] = branchName;

    if (conversation.customerId !== null) {
      const appointmentId = await repo.nextAppointmentId(tx, conversation.customerId, new Date());
      const summary =
        appointmentId === undefined
          ? undefined
          : await remindersRepo.findAppointmentSummary(tx, appointmentId);
      if (summary !== undefined) {
        // Müşteri adı sohbetin bağlı müşterisinden geliyor; randevu özetindeki aynı değer.
        const { appointmentAt, serviceName } = appointmentVariables(summary);
        Object.assign(values, { appointmentAt, serviceName });
      }
    }
    return values;
  }

  private static sendable(row: TemplateRow): boolean {
    return (
      row.status === 'approved' &&
      row.category !== null &&
      SENDABLE_CATEGORIES.has(row.category) &&
      row.buttons.length === 0 &&
      ConversationsService.bodyOf(row) !== null
    );
  }

  /** Senkronize metin; eski satırlarda standart setten konumsal gövde. */
  private static bodyOf(row: TemplateRow): string | null {
    if (row.bodyText !== null && row.bodyText.length > 0) return row.bodyText;
    const standard = STANDARD_TEMPLATE_BY_NAME.get(row.name);
    return standard?.body === undefined ? null : positionalBody(standard);
  }

  private static toOption(
    row: TemplateRow,
    suggestions: Record<string, string>,
  ): ConversationTemplateOptionDto | null {
    const bodyText = ConversationsService.bodyOf(row);
    if (bodyText === null) return null;
    const standard = STANDARD_TEMPLATE_BY_NAME.get(row.name);
    const variableNames = Array.from({ length: row.bodyVariableCount }, (_, index) => {
      const name = standard?.variables[index];
      return name ?? null;
    });
    return {
      name: row.name,
      language: row.language,
      category: 'UTILITY',
      bodyText,
      bodyVariableCount: row.bodyVariableCount,
      variableNames,
      suggestedParameters: variableNames.map((name) =>
        name === null ? '' : (suggestions[name] ?? ''),
      ),
    };
  }

  /** `{{1}}` → parametre. */
  private static render(body: string, parameters: string[]): string {
    return body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => parameters[Number(index) - 1] ?? match);
  }

  async markRead(id: string): Promise<void> {
    const found = await this.tx.run((tx) => repo.markRead(tx, id));
    if (!found) throw AppError.notFound('Sohbet bulunamadı');
  }

  async setStatus(
    principal: Principal,
    id: string,
    status: 'open' | 'closed',
  ): Promise<ConversationDto> {
    return this.tx.run(async (tx) => {
      const found = await repo.setStatus(tx, id, status, principal.userId);
      if (!found) throw AppError.notFound('Sohbet bulunamadı');
      return ConversationsService.toDto((await repo.findById(tx, id)) as repo.ConversationRow);
    });
  }

  async linkCustomer(id: string, customerId: string): Promise<ConversationDto> {
    return this.tx.run(async (tx) => {
      if (!(await repo.customerExists(tx, customerId))) {
        throw new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Müşteri bulunamadı', {
          extra: { errors: [{ path: 'customerId', message: 'Müşteri bulunamadı' }] },
        });
      }
      const found = await repo.linkCustomer(tx, id, customerId);
      if (!found) throw AppError.notFound('Sohbet bulunamadı');
      return ConversationsService.toDto((await repo.findById(tx, id)) as repo.ConversationRow);
    });
  }

  private static windowOpen(row: repo.ConversationRow, now = new Date()): boolean {
    return row.lastInboundAt !== null && now.getTime() - row.lastInboundAt.getTime() < WINDOW_MS;
  }

  private static toDto(row: repo.ConversationRow): ConversationDto {
    const windowOpen = ConversationsService.windowOpen(row);
    return {
      id: row.id,
      phone: row.phone,
      customer:
        row.customerId === null || row.customerName === null
          ? null
          : { id: row.customerId, fullName: row.customerName },
      status: row.status,
      lastMessageAt: row.lastMessageAt.toISOString(),
      lastMessagePreview: row.lastMessagePreview,
      lastMessageDirection: row.lastMessageDirection,
      unread:
        row.lastInboundAt !== null &&
        (row.lastReadAt === null || row.lastInboundAt.getTime() > row.lastReadAt.getTime()),
      windowOpen,
      windowExpiresAt:
        row.lastInboundAt === null
          ? null
          : new Date(row.lastInboundAt.getTime() + WINDOW_MS).toISOString(),
    };
  }

  private static toMessageDto(row: repo.ThreadRow): ConversationMessageDto {
    return {
      id: row.id,
      direction: row.direction,
      type: row.messageType,
      body: row.body,
      createdAt: row.at.toISOString(),
      status: row.status,
      event: row.event,
      sentByName: row.sentByName,
      errorDetail: row.errorDetail,
      appointmentId: row.appointmentId,
    };
  }

  private static encodeCursor(row: repo.ConversationRow): string {
    return Buffer.from(`${row.lastMessageAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
  }

  private static decodeCursor(cursor: string): { at: string; id: string } {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (
      at === undefined ||
      id === undefined ||
      Number.isNaN(Date.parse(at)) ||
      !/^[0-9a-f-]{36}$/i.test(id)
    ) {
      throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Geçersiz cursor');
    }
    return { at, id };
  }
}
