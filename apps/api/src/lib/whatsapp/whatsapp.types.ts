export interface WhatsAppCredentials {
  phoneNumberId: string;
  /** DÜZ METİN token — yalnız gönderim anında, bellekte. */
  accessToken: string;
  apiVersion: string;
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode: string;
  /** Meta'nın konumsal parametreleri — sıra ÖNEMLİ (`{{1}}`, `{{2}}`…). */
  parameters: string[];
  /**
   * Quick-reply butonlarının yükü. Onayla/İptal butonlarının tek kullanımlık
   * token'ı buradan gider (8.3 çözer).
   */
  buttonPayloads?: string[];
}

export interface WhatsAppTextMessage {
  to: string;
  body: string;
}

export interface WhatsAppSendResult {
  /** Meta'nın mesaj kimliği — teslim bildirimi (8.3) bununla eşleşir. */
  messageId: string | null;
}

export interface WhatsAppTemplateInfo {
  name: string;
  language: string;
  category: string | null;
  status: 'pending' | 'approved' | 'rejected';
  bodyVariableCount: number;
  buttons: { type: string; text: string }[];
}

/**
 * WhatsApp Cloud API istemcisi.
 *
 * Sağlayıcı ADAPTER ARKASINDADIR: servis katmanı `WHATSAPP_CLIENT` token'ını
 * enjekte eder ve HTTP ayrıntılarını bilmez. Testler aynı arayüzü uygulayan
 * yerel bir mock sunucuya karşı koşar — gerçek Graph API'ye çağrı yapılmaz.
 */
export interface WhatsAppClient {
  sendTemplate(
    credentials: WhatsAppCredentials,
    message: WhatsAppTemplateMessage,
  ): Promise<WhatsAppSendResult>;
  sendText(
    credentials: WhatsAppCredentials,
    message: WhatsAppTextMessage,
  ): Promise<WhatsAppSendResult>;
  listTemplates(
    credentials: WhatsAppCredentials,
    wabaId: string,
  ): Promise<WhatsAppTemplateInfo[]>;
}

export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');
