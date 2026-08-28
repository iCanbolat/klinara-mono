export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * E-posta gönderim arayüzü.
 *
 * İki uygulaması var ve seçim `SMTP_HOST`a bakar (bkz. `mail.module.ts`):
 * yapılandırılmışsa `SmtpMailSender`, değilse içeriği loga yazan gönderici.
 * Çağıran hangisinin koştuğunu bilmez.
 */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');
