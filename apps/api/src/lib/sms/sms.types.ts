export interface SmsMessage {
  /** E.164 numara (`+905321234567`). */
  to: string;
  body: string;
}

export interface SmsResult {
  provider: string;
  /** Sağlayıcının iş kimliği — destek talebinde gönderimi bulmak için. */
  providerMessageId: string | null;
}

/**
 * SMS gönderim arayüzü.
 *
 * Sağlayıcı ADAPTER ARKASINDADIR (mimari karar, bkz. bölüm 2): Netgsm ilk
 * uygulamadır, sağlayıcı değişimi yalnız bu klasörü etkiler. Servis katmanı
 * `SMS_SENDER` token'ını enjekte eder ve hangi sağlayıcının koştuğunu bilmez.
 */
export interface SmsSender {
  send(message: SmsMessage): Promise<SmsResult>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');
