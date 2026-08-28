import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@klinara/shared';
import { MAIL_SENDER, type MailSender } from '../../lib/mail/mail.types';
import { SMS_SENDER, type SmsSender } from '../../lib/sms/sms.types';
import type { NotificationChannel } from '../../database/schema';
import { WhatsAppSenderService } from '../integrations/whatsapp-sender.service';
import { PermanentSendError, TransientSendError } from './send-errors';

export interface OutboundMessage {
  tenantId: string;
  channel: NotificationChannel;
  /** Ham adres — YALNIZ gönderim anında, worker'ın belleğinde bulunur. */
  to: string;
  subject?: string | undefined;
  body: string;
  /**
   * WhatsApp'a özgü yük. Template adı VERİLMİŞSE template mesajı gider;
   * verilmemişse serbest metin denenir ve 24 saatlik pencere kapalıysa
   * gönderim reddedilir (8.2).
   */
  whatsapp?:
    | {
        templateName?: string | undefined;
        templateLanguage?: string | undefined;
        parameters?: string[] | undefined;
      }
    | undefined;
}

export interface SendOutcome {
  provider: string;
  providerMessageId: string | null;
}

/**
 * Kanal → adapter eşlemesi.
 *
 * Bildirim çekirdeği hangi sağlayıcının koştuğunu bilmez; kanal ekleme ya da
 * sağlayıcı değiştirme tek bir dosyayı etkiler (`lib/sms`, `lib/mail`,
 * `lib/whatsapp`). Bu, SMS adapter'ında Faz 1'de alınan kararın aynısıdır.
 */
@Injectable()
export class ChannelRegistryService {
  constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly whatsapp: WhatsAppSenderService,
  ) {}

  async send(message: OutboundMessage): Promise<SendOutcome> {
    switch (message.channel) {
      case 'email': {
        await this.mail.send({
          to: message.to,
          subject: message.subject ?? '',
          body: message.body,
        });
        return { provider: 'smtp', providerMessageId: null };
      }
      case 'sms': {
        const result = await this.sms.send({ to: message.to, body: message.body });
        return { provider: result.provider, providerMessageId: result.providerMessageId };
      }
      case 'whatsapp': {
        const result = await this.whatsapp.send(message.tenantId, {
          to: message.to,
          body: message.body,
          templateName: message.whatsapp?.templateName,
          templateLanguage: message.whatsapp?.templateLanguage,
          parameters: message.whatsapp?.parameters,
        });
        return { provider: 'whatsapp', providerMessageId: result.messageId };
      }
      case 'push': {
        // Mobil push kapsam dışı (bkz. bölüm 10); kanal enum'da yeri hazır.
        throw new PermanentSendError(
          ERROR_CODES.CHANNEL_NOT_CONFIGURED,
          'Push kanalı bu sürümde desteklenmiyor',
        );
      }
      default: {
        throw new TransientSendError(`Bilinmeyen kanal: ${String(message.channel)}`);
      }
    }
  }

  /** Kanalın kullanabileceği adres türü — alıcıda o alan yoksa kanal atlanır. */
  static addressFor(
    channel: NotificationChannel,
    contact: { phone?: string | null; email?: string | null },
  ): string | undefined {
    switch (channel) {
      case 'email':
        return contact.email ?? undefined;
      case 'sms':
      case 'whatsapp':
        return contact.phone ?? undefined;
      default:
        return undefined;
    }
  }
}
