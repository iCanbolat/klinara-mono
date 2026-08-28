import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MAIL_SENDER, type MailMessage, type MailSender } from './mail.types';
import { SmtpMailSender } from './smtp.sender';

/**
 * Gönderim yapmayan, içeriği loga yazan gönderici.
 *
 * `sent` listesi testler için: gerçek bir SMTP sunucusu olmadan "davet
 * e-postası gitti mi?" sorusu bu liste üzerinden cevaplanır.
 */
export class LogMailSender implements MailSender {
  readonly sent: MailMessage[] = [];

  constructor(private readonly logger: PinoLogger) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    if (this.sent.length > 50) this.sent.shift();
    this.logger.warn({ subject: message.subject }, 'E-posta loga yazıldı');
  }
}

/**
 * Gönderici seçimi tek yerde — `SmsModule` fabrikasının aynısı.
 *
 * `SMTP_HOST` boşsa gerçek gönderici HİÇ KURULMAZ: yanlış yapılandırılmış bir
 * ortamda sessizce gönderim denemek yerine loga yazmak güvenli varsayılandır.
 */
function createMailSender(
  config: ConfigService<EnvironmentVariables, true>,
  logger: PinoLogger,
): MailSender {
  const host = config.get('SMTP_HOST', { infer: true });
  if (host === undefined || host === '') return new LogMailSender(logger);

  return new SmtpMailSender(
    {
      host,
      port: config.get('SMTP_PORT', { infer: true }),
      user: config.get('SMTP_USER', { infer: true }),
      password: config.get('SMTP_PASSWORD', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      from: config.get('MAIL_FROM', { infer: true }),
    },
    logger,
  );
}

@Global()
@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [ConfigService, PinoLogger],
      useFactory: createMailSender,
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
