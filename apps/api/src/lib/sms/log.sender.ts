import { PinoLogger } from 'nestjs-pino';
import { maskPhone } from '../../observability/redaction';
import type { SmsMessage, SmsResult, SmsSender } from './sms.types';

/**
 * Yerel geliştirme ve test göndericisi.
 *
 * Netgsm kimlik bilgileri tanımlı değilse bu uygulama devreye girer: SMS
 * DIŞARI ÇIKMAZ, içerik loga yazılır. Geliştirici kodu logdan okur; gerçek bir
 * numaraya mesaj gitmez ve fatura oluşmaz.
 */
export class LogSmsSender implements SmsSender {
  /** Testlerin okuyabilmesi için son gönderilen mesajlar. */
  readonly sent: SmsMessage[] = [];

  constructor(private readonly logger: PinoLogger) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    this.sent.push(message);
    if (this.sent.length > 50) this.sent.shift();

    this.logger.warn(
      { provider: 'log', to: maskPhone(message.to), body: message.body },
      'SMS gönderilmedi (sağlayıcı yapılandırılmamış) — içerik loga yazıldı',
    );
    return { provider: 'log', providerMessageId: null };
  }
}
