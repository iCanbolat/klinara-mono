import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { isPgError, PG_ERROR } from '../../common/errors/db-errors';
import { maskEmail, maskPhone } from '../../observability/redaction';
import type { Tx } from '../../database/tenant-tx';
import type { NotificationChannel, NotificationEvent } from '../../database/schema';
import { QUEUES } from '../../lib/queue/queue.constants';
import { QueueService } from '../../lib/queue/queue.service';
import { ChannelRegistryService } from './channel-registry.service';
import { STANDARD_TEMPLATE_BY_EVENT } from '../integrations/whatsapp-standard-templates';
import { CUSTOMER_CHANNELS, EVENT_DEFINITIONS, isCustomerEvent } from './default-templates';
import * as repo from './notifications.repository';
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
  /** Olayın varsayılan kanallarını ezmek için (tekil, elle gönderim). */
  channels?: NotificationChannel[];
  locale?: string;
  /**
   * Mesajın hakkında olduğu randevu. Hatırlatmanın Onayla/İptal butonları
   * token'ı gönderim anında bununla üretiyor.
   */
  appointmentId?: string;
}

export type EnqueueResult =
  | { status: 'queued'; messageId: string; scheduledFor: Date; channel: NotificationChannel }
  | { status: 'skipped'; reason: string; messageId?: string }
  | { status: 'duplicate' };

/**
 * Bildirim üretiminin TEK giriş noktası.
 *
 * Randevu, paket ve finans modülleri kanal, şablon ya da sağlayıcı bilmez;
 * yalnız "şu olay, şu alıcı, şu değişkenler" der. Kanal seçimi
 * ve çift gönderim koruması burada, tek yerde uygulanır — bu
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

    const requestedChannels = input.channels ?? definition.channels;

    // Müşteriye e-posta GİTMEZ. Kural yeni; kiracıların kayıtlı tercih
    // listeleri hâlâ `email` taşıyor olabilir ve süzülmezse ilk sırada duran
    // ölü bir kanal WhatsApp'ın önünü keserdi.
    const customerChannels = isCustomerEvent(input.event)
      ? requestedChannels.filter((candidate) => CUSTOMER_CHANNELS.includes(candidate))
      : requestedChannels;

    // WhatsApp hesabı bağlanıp DOĞRULANMAMIŞ kiracıda WhatsApp atlanır.
    // Atlanmasaydı müşterinin telefonu olduğu için WhatsApp seçilir, gönderim
    // `WHATSAPP_NOT_CONFIGURED` ile düşer ve günlükte başarısız bir satır
    // kalırdı; gönderilemeyecek mesaj hiç yazılmıyor.
    //
    // Kullanılacak template Meta'da ONAYLI DEĞİLSE de aynısı geçerli: Meta
    // onay bekleyen template'i reddediyor (#132001).
    //
    // Otomatik cevap muaf: o, WhatsApp'tan GELEN bir mesaja veriliyor ve
    // webhook'un gelmiş olması hesabın çalıştığının kanıtı — "Doğrula"ya hiç
    // basılmamış olması bunu değiştirmez.
    const wanted =
      input.event !== 'auto_reply' &&
      customerChannels.includes('whatsapp') &&
      !(await this.whatsAppDeliverable(tx, input.event, locale, contact.phone ?? undefined))
        ? customerChannels.filter((candidate) => candidate !== 'whatsapp')
        : customerChannels;

    // Adresi olmayan kanal ATLANIR: e-postası olmayan bir müşteriye e-posta
    // "denemek" yalnız başarısız bir satır üretirdi.
    const channel = wanted.find(
      (candidate) => ChannelRegistryService.addressFor(candidate, contact) !== undefined,
    );

    if (channel === undefined) {
      // Hiç adres yoksa mesaj kaydı da YAZILMAZ: gönderilebilir bir şey hiç
      // var olmadı.
      this.logger.debug(
        { event: input.event, customerId: input.customerId },
        'Bildirim atlandı: uygun kanal yok',
      );
      return { status: 'skipped', reason: 'Alıcının bu kanallarda adresi yok' };
    }

    const address = ChannelRegistryService.addressFor(channel, contact) as string;
    const toMasked = channel === 'email' ? maskEmail(address) : maskPhone(address);

    const template = await repo.findTemplate(tx, { event: input.event, channel, locale });
    if (template !== undefined && !template.isActive) {
      return { status: 'skipped', reason: 'Şablon pasif' };
    }

    // WhatsApp'ın varsayılan METNİ yoktur: pencere dışında yalnız Meta'da
    // onaylı template gönderilebilir (8.2). Yine de kayda yazılacak bir metin
    // gerekiyor — standart template'in metni: sohbet ekranında müşterinin
    // gerçekten gördüğü metin görünmeli.
    const standard =
      channel === 'whatsapp' && template?.whatsappTemplateName == null
        ? STANDARD_TEMPLATE_BY_EVENT.get(input.event)
        : undefined;
    const standardBody =
      channel === 'whatsapp' ? STANDARD_TEMPLATE_BY_EVENT.get(input.event)?.body : undefined;
    const fallback =
      definition.templates[channel] ??
      (standardBody === undefined ? undefined : { body: standardBody, subject: undefined });
    const body = (standard === undefined ? template?.body : undefined) ?? fallback?.body;
    if (body === undefined) {
      return { status: 'skipped', reason: `Kanal için şablon yok: ${channel}` };
    }
    const subject = template?.subject ?? fallback?.subject;

    const rendered = {
      subject: subject === undefined ? null : renderTemplate(subject, input.variables),
      body: renderTemplate(body, input.variables),
    };

    const scheduledFor = input.scheduledFor ?? new Date();

    try {
      const row = await repo.insertMessage(tx, {
        tenantId,
        branchId,
        customerId: input.customerId ?? null,
        userId: input.userId ?? null,
        channel,
        event: input.event,
        status: 'queued',
        toMasked,
        templateId: template?.id ?? null,
        renderedSubject: rendered.subject,
        renderedBody: rendered.body,
        scheduledFor,
        dedupeKey: input.dedupeKey ?? null,
        appointmentId: input.appointmentId ?? null,
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

  /** Hesap doğrulanmış VE olayın kullanacağı template Meta'da onaylı mı? */
  private async whatsAppDeliverable(
    tx: Tx,
    event: NotificationEvent,
    locale: string,
    phone: string | undefined,
  ): Promise<boolean> {
    if (!(await repo.isWhatsAppReady(tx))) return false;

    const mapped = await repo.findTemplate(tx, { event, channel: 'whatsapp', locale });
    const standard = STANDARD_TEMPLATE_BY_EVENT.get(event);
    const name = mapped?.whatsappTemplateName ?? standard?.name;
    if (name === undefined) return false;

    const language = mapped?.whatsappTemplateLanguage ?? standard?.language ?? locale;
    // Yansımada satır YOKSA engellenmez: durumu bilmiyoruz demektir (hesap
    // henüz eşitlenmemiş olabilir) ve kararı Meta'ya bırakmak, gönderilebilir
    // bir mesajı susturmaktan iyidir. Satır varsa ve onaylı değilse Meta
    // zaten reddedeceği için WhatsApp atlanır.
    const status = await repo.whatsAppTemplateStatus(tx, name, language);
    if (status === undefined || status === 'approved') return true;

    // GELİŞTİRME ortamı: template'ler Meta onayını beklerken akış denenemez
    // hâle geliyordu. Pencere açıkken serbest metin Meta'nın izin verdiği bir
    // gönderim; worker template'i düşürüp metni yolluyor. ÜRETİMDE yok:
    // orada pencere kapalı bir müşteriye giden mesaj sessizce kaybolurdu.
    return (
      this.config.get('NODE_ENV', { infer: true }) !== 'production' &&
      phone !== undefined &&
      (await repo.isWhatsAppWindowOpen(tx, phone))
    );
  }
}
