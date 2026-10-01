export interface MailMessage {
  to: string;
  subject: string;
  /** Düz metin gövde; her zaman verilir (HTML görüntüleyemeyen istemci için de). */
  body: string;
  /** Biçimli gövde. Yalnız HTML destekleyen göndericiler kullanır. */
  html?: string;
}

/**
 * E-posta gönderim arayüzü.
 *
 * Üç uygulaması var ve seçim ortama bakar (bkz. `mail.module.ts`):
 * `RESEND_API_KEY` varsa `ResendMailSender`, yoksa `SMTP_HOST` varsa `SmtpMailSender`,
 * ikisi de yoksa içeriği loga yazan gönderici.
 * Çağıran hangisinin koştuğunu bilmez.
 */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');
