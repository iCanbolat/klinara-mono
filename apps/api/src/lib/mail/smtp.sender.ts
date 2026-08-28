import { createTransport, type Transporter } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';
import type { MailMessage, MailSender } from './mail.types';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  secure: boolean;
  from: string;
}

/**
 * SMTP göndericisi (nodemailer).
 *
 * Yerelde MailHog (`localhost:1025`, kimlik doğrulamasız), üretimde gerçek
 * sağlayıcı. Ayrım YALNIZ yapılandırmadadır: kod aynı, dolayısıyla "yerelde
 * çalışıyordu" durumu SMTP katmanından doğmaz.
 *
 * Gönderim hatası YUKARI FIRLATILIR. Yutulsaydı çağıran (bildirim worker'ı)
 * mesajı `sent` yazar ve kullanıcı hiç gelmeyen bir e-postayı beklerdi;
 * hatanın kuyruğa dönmesi yeniden denemeyi mümkün kılar.
 */
export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;

  constructor(
    private readonly config: SmtpConfig,
    private readonly logger: PinoLogger,
  ) {
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // Kimlik bilgisi yoksa `auth` HİÇ verilmez: MailHog gibi kimlik
      // doğrulamasız sunucular boş kullanıcıyla gelen AUTH komutunu reddeder.
      ...(config.user !== undefined && config.user !== ''
        ? { auth: { user: config.user, pass: config.password ?? '' } }
        : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    // `sendMail` taşıyıcıya göre değişen bir yük döndürür ve tipi `any`dir;
    // ihtiyacımız olan tek alanı daraltarak alıyoruz.
    const info = (await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    })) as { messageId?: string };
    // Alıcı adresi loglanmaz: gövde zaten hiç loglanmıyor, adres de kişisel veri.
    this.logger.debug({ messageId: info.messageId }, 'E-posta gönderildi');
  }
}
