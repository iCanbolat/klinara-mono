import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES } from '@klinara/shared';
import type { EnvironmentVariables } from '../../config/env.validation';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { maskEmail, maskPhone } from '../../observability/redaction';
import type { Tx } from '../../database/tenant-tx';
import type {
  NotificationChannel,
  NotificationEvent,
  NotificationKind,
} from '../../database/schema';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { ChannelRegistryService } from './channel-registry.service';
import { EVENT_DEFINITIONS } from './default-templates';
import * as repo from './notifications.repository';
import { isQuietHour, nextSendableInstant } from './quiet-hours';
import { renderTemplate } from './template-renderer';

export interface EnqueueInput {
  event: NotificationEvent;
  /** Müşteri VEYA kullanıcı; tam olarak biri. */
  customerId?: string;
  userId?: string;
  branchId?: string | null;
  variables: Record<string, string>;
  /** Çift gönderim koruması — aynı anahtarla ikinci satır yazılamaz. */
  dedupeKey?: string;
  scheduledFor?: Date;
  /** Tercihi ezmek için (tekil, elle gönderim). */
  channels?: NotificationChannel[];
  locale?: string;
}

export type EnqueueResult =
  | { status: 'queued'; messageId: string; scheduledFor: Date; channel: NotificationChannel }
  | { status: 'skipped'; reason: string; messageId?: string }
  | { status: 'duplicate' };

/**
 * Bildirim üretiminin TEK giriş noktası.
 *
 * Randevu, paket ve finans modülleri kanal, şablon ya da sağlayıcı bilmez;
 * yalnız "şu olay, şu alıcı, şu değişkenler" der. Kanal seçimi, opt-out,
 * sessiz saat ve çift gönderim koruması burada, tek yerde uygulanır — bu
 * kontrollerin çağıran başına tekrarlanması, er ya da geç yalnız birinde
 * unutulan bir kontrol demekti.
 *
 * İş, ÇAĞIRANIN transaction'ına yazılır: randevu rollback olursa mesaj da
 * yazılmaz (mimari karar 4.6).
 */
@Injectable()
export class NotificationDispatcherService {
  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly logger: PinoLogger,
  ) {}

  async enqueue(tx: Tx, tenantId: string, input: EnqueueInput): Promise<EnqueueResult> {
    const definition = EVENT_DEFINITIONS[input.event];
    const branchId = input.branchId ?? null;
    const locale = input.locale ?? 'tr';

    const contact =
      input.customerId !== undefined
        ? await repo.findCustomerContact(tx, input.customerId)
        : input.userId !== undefined
          ? await repo.findUserContact(tx, input.userId)
          : undefined;

    if (contact === undefined) {
      return { status: 'skipped', reason: 'Alıcı bulunamadı' };
    }

    const preference = await repo.findEffectivePreference(tx, { event: input.event, branchId });
    const wanted = input.channels ?? preference?.channels ?? definition.channels;

    // Adresi olmayan kanal ATLANIR: e-postası olmayan bir müşteriye e-posta
    // "denemek" yalnız başarısız bir satır üretirdi.
    const channel = wanted.find(
      (candidate) => ChannelRegistryService.addressFor(candidate, contact) !== undefined,
    );

    if (channel === undefined) {
      // Hiç adres yoksa mesaj kaydı da YAZILMAZ: gönderilebilir bir şey hiç
      // var olmadı. Opt-out'tan farkı bu — orada gönderilebilir bir mesaj
      // BİLEREK engellenir ve iz bırakır.
      this.logger.debug(
        { event: input.event, customerId: input.customerId },
        'Bildirim atlandı: uygun kanal yok',
      );
      return { status: 'skipped', reason: 'Alıcının bu kanallarda adresi yok' };
    }

    const address = ChannelRegistryService.addressFor(channel, contact) as string;
    const toMasked = channel === 'email' ? maskEmail(address) : maskPhone(address);
    const kind: NotificationKind = definition.kind;

    const template = await repo.findTemplate(tx, { event: input.event, channel, locale });
    if (template !== undefined && !template.isActive) {
      return { status: 'skipped', reason: 'Şablon pasif' };
    }

    // WhatsApp'ın varsayılan METNİ yoktur: pencere dışında yalnız Meta'da
    // onaylı template gönderilebilir (8.2). Yine de kayda yazılacak bir metin
    // gerekiyor — SMS gövdesi bu iş için birebir aynı bilgiyi taşır.
    const fallback =
      definition.templates[channel] ??
      (channel === 'whatsapp' ? definition.templates.sms : undefined);
    const body = template?.body ?? fallback?.body;
    if (body === undefined) {
      return { status: 'skipped', reason: `Kanal için şablon yok: ${channel}` };
    }
    const subject = template?.subject ?? fallback?.subject;

    const rendered = {
      subject: subject === undefined ? null : renderTemplate(subject, input.variables),
      body: renderTemplate(body, input.variables),
    };

    const requested = input.scheduledFor ?? new Date();

    // --- Opt-out --------------------------------------------------------
    // İşlemsel ileti opt-out'tan ETKİLENMEZ: randevusunu bilmemek müşterinin
    // kendi zararınadır ve bu bir ticari ileti değildir.
    if (kind === 'marketing' && input.customerId !== undefined) {
      const optOuts = await repo.listActiveOptOuts(tx, input.customerId);
      const blocked = optOuts.some(
        (row) => row.kind === 'marketing' && (row.channel === null || row.channel === channel),
      );
      if (blocked) {
        // Engellenen mesaj ATILMAZ: "gitmedi mi, hiç denendi mi?" sorusu
        // cevaplanabilir kalmalı.
        const row = await repo.insertMessage(tx, {
          tenantId,
          branchId,
          customerId: input.customerId,
          channel,
          event: input.event,
          kind,
          status: 'skipped',
          toMasked,
          templateId: template?.id ?? null,
          renderedSubject: rendered.subject,
          renderedBody: rendered.body,
          errorCode: ERROR_CODES.OPT_OUT,
          errorDetail: 'Müşteri pazarlama iletilerini reddetmiş',
          scheduledFor: requested,
        });
        return { status: 'skipped', reason: ERROR_CODES.OPT_OUT, messageId: row.id };
      }
    }

    // --- Sessiz saatler --------------------------------------------------
    // Personele giden iç bildirim ve gelen mesaja verilen otomatik cevap
    // ERTELENMEZ: birini sabaha saklamak bildirimin var olma sebebini,
    // diğerini saklamak da konuşmanın kendisini bozardı.
    const scheduledFor =
      input.event === 'staff_internal' || input.event === 'auto_reply'
        ? requested
        : this.applyQuietHours(requested, await repo.resolveTimezone(tx, branchId), preference);

    try {
      const row = await repo.insertMessage(tx, {
        tenantId,
        branchId,
        customerId: input.customerId ?? null,
        userId: input.userId ?? null,
        channel,
        event: input.event,
        kind,
        status: 'queued',
        toMasked,
        templateId: template?.id ?? null,
        renderedSubject: rendered.subject,
        renderedBody: rendered.body,
        scheduledFor,
        dedupeKey: input.dedupeKey ?? null,
        // WhatsApp template'ine DEĞERLERİN KENDİSİ gider; render edilmiş
        // gövde yetmez (8.2). Diğer kanallarda da saklanıyor: aynı mesajı
        // yeniden üretebilmek destek tarafında bedava bir kazanç.
        templateVariables: input.variables,
      });

      await this.queue.send(
        tx,
        QUEUES.NOTIFICATION_SEND,
        { tenantId, messageId: row.id },
        {
          startAfter: scheduledFor,
          singletonKey: `notification:${row.id}`,
        },
      );

      return { status: 'queued', messageId: row.id, scheduledFor, channel };
    } catch (error) {
      // Kısmi tekil indeks: aynı `dedupe_key` ile ikinci satır yazılamaz.
      // Bu bir HATA DEĞİL, korumanın çalışmasıdır.
      if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) return { status: 'duplicate' };
      throw error;
    }
  }

  private applyQuietHours(
    requested: Date,
    timezone: string,
    preference: repo.NotificationPreferenceRow | undefined,
  ): Date {
    const start =
      preference?.quietHoursStart ??
      this.config.get('NOTIFICATION_QUIET_HOURS_START', { infer: true });
    const end =
      preference?.quietHoursEnd ?? this.config.get('NOTIFICATION_QUIET_HOURS_END', { infer: true });

    const window = { start: (start ?? '21:00').slice(0, 5), end: (end ?? '09:00').slice(0, 5) };
    if (!isQuietHour(requested, timezone, window)) return requested;
    return nextSendableInstant(requested, timezone, window);
  }
}
