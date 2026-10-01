import { PinoLogger } from 'nestjs-pino';
import type { MailMessage, MailSender } from './mail.types';

export interface ResendConfig {
  apiKey: string;
  /** Resend'de doğrulanmış alan adından bir adres: `Klinara <davet@klinara.app>`. */
  from: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend göndericisi (REST).
 *
 * Ek bir paket yok: tek uç (`POST /emails`) ve yerleşik `fetch`. Gönderim
 * hatası YUKARI FIRLATILIR — SMTP göndericisiyle aynı sözleşme: yutulsaydı
 * davet e-postası gitmemişken kayıt "gönderildi" görünürdü.
 */
export class ResendMailSender implements MailSender {
  constructor(
    private readonly config: ResendConfig,
    private readonly logger: PinoLogger,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
        ...(message.html === undefined ? {} : { html: message.html }),
      }),
    });

    if (!response.ok) {
      // Yanıt gövdesi hata kodunu taşır (`name`, `message`); alıcı adresi
      // loglanmaz, kişisel veri.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      this.logger.error({ status: response.status, detail }, 'Resend e-postayı reddetti');
      throw new Error(`Resend gönderimi başarısız (HTTP ${response.status})`);
    }

    const { id } = (await response.json().catch(() => ({}))) as { id?: string };
    this.logger.debug({ messageId: id }, 'E-posta gönderildi');
  }
}
