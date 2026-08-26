import { Global, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MAIL_SENDER, type MailMessage, type MailSender } from './mail.types';

class LogMailSender implements MailSender {
  readonly sent: MailMessage[] = [];

  constructor(private readonly logger: PinoLogger) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    if (this.sent.length > 50) this.sent.shift();
    this.logger.warn({ to: message.to, subject: message.subject }, 'E-posta loga yazıldı');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger): MailSender => new LogMailSender(logger),
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
