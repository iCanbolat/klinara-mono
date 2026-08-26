export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * E-posta gönderim arayüzü.
 *
 * Faz 1'de yalnız loga yazan uygulaması vardır: davet ve parola sıfırlama
 * bağlantıları geliştirme ortamında logdan okunur. Gerçek SMTP/sağlayıcı
 * uygulaması Batch 8.1'de (bildirim çekirdeği) gelecek — arayüz o gün
 * değişmeyecek şekilde şimdiden buradadır.
 */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');
