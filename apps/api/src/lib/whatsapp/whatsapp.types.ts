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
  /**
   * Dinamik URL butonu: Meta'da alan adı sabit, yalnız SONUNA eklenen kısım
   * (`{{1}}`) gönderimde verilir. `index` butonun template'teki sırasıdır
   * (önce quick-reply'lar gelir).
   */
  urlButton?: { index: number; suffix: string };
  /**
   * Kimlik doğrulama (AUTHENTICATION) template'inin "Kodu kopyala" butonu.
   * Meta kodu HEM gövdede HEM bu butonda ister; biri eksikse gönderim
   * parametre uyuşmazlığıyla reddedilir.
   */
  copyCode?: string;
}

/** Meta'da oluşturulacak bir template'in tanımı (`POST /{waba}/message_templates`). */
export interface WhatsAppTemplateDraft {
  name: string;
  language: string;
  /** Klinara yalnız işlemsel ve kimlik doğrulama template'i yazar; pazarlama yok. */
  category: 'UTILITY' | 'AUTHENTICATION';
  /** Konumsal gövde (`{{1}}`…). AUTHENTICATION'da Meta metni kendisi üretir. */
  body?: string;
  /** Her değişken için örnek değer — Meta değişkenli gövdeyi örneksiz reddeder. */
  bodyExamples?: string[];
  quickReplies?: string[];
  /** Sabit alan adlı, sonu değişkenli URL butonu (quick-reply'lardan sonra gelir). */
  urlButton?: { text: string; url: string; example: string };
  /** Yalnız AUTHENTICATION: kodun geçerlilik süresi (dakika). */
  codeExpirationMinutes?: number;
}

export interface WhatsAppTemplateCreated {
  id: string | null;
  status: 'pending' | 'approved' | 'rejected';
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
  /** BODY metni, `{{1}}` yer tutucularıyla. */
  bodyText: string | null;
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
  createTemplate(
    credentials: WhatsAppCredentials,
    wabaId: string,
    draft: WhatsAppTemplateDraft,
  ): Promise<WhatsAppTemplateCreated>;
  /** Uygulamayı WABA'ya abone eder; abone olunmadan Meta o hesabın webhook'larını göndermez. */
  subscribeApp(credentials: WhatsAppCredentials, wabaId: string): Promise<void>;
}

export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');
