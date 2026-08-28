import { ERROR_CODES } from '@klinara/shared';
import { PinoLogger } from 'nestjs-pino';
import { PermanentSendError, TransientSendError } from '../../modules/notifications/send-errors';
import type {
  WhatsAppClient,
  WhatsAppCredentials,
  WhatsAppSendResult,
  WhatsAppTemplateInfo,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from './whatsapp.types';

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number };
}

interface GraphSendResponse {
  messages?: { id?: string }[];
}

interface GraphTemplateResponse {
  data?: {
    name?: string;
    language?: string;
    category?: string;
    status?: string;
    components?: { type?: string; text?: string; buttons?: { type?: string; text?: string }[] }[];
  }[];
}

/**
 * Meta hata kodu → bizim kodumuz ve YENİDEN DENEME sınıfı.
 *
 * Tablo hâlinde durması kasıtlı: sınıflama gönderim worker'ının davranışını
 * belirliyor (kalıcı hata `failed` yazıp biter, geçici hata kuyruğa döner) ve
 * bir kodun yanlış sınıfa düşmesi ya sonsuz yeniden deneme ya da kaybolan bir
 * mesaj demek.
 */
const PERMANENT_CODES: Record<number, (typeof ERROR_CODES)[keyof typeof ERROR_CODES]> = {
  // OAuth: token geçersiz ya da süresi dolmuş.
  190: ERROR_CODES.WHATSAPP_NOT_CONFIGURED,
  200: ERROR_CODES.WHATSAPP_NOT_CONFIGURED,
  // Numara WhatsApp kullanıcısı değil / mesaj teslim edilemiyor.
  131026: ERROR_CODES.WHATSAPP_INVALID_RECIPIENT,
  131051: ERROR_CODES.WHATSAPP_INVALID_RECIPIENT,
  // 24 saat penceresi dışında serbest metin.
  131047: ERROR_CODES.WHATSAPP_WINDOW_CLOSED,
  131052: ERROR_CODES.WHATSAPP_WINDOW_CLOSED,
  // Template yok / onaysız / parametre uyuşmuyor.
  132000: ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
  132001: ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
  132005: ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
  132007: ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
  132012: ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
  132015: ERROR_CODES.WHATSAPP_TEMPLATE_NOT_APPROVED,
};

/** Kota ve geçici sağlayıcı hataları — yeniden denenir. */
const TRANSIENT_CODES = new Set([4, 80007, 130429, 131048, 131056, 133016]);

export interface GraphClientConfig {
  /** Testlerde yerel mock sunucuya işaret eder. */
  baseUrl: string;
  timeoutMs: number;
}

export class GraphWhatsAppClient implements WhatsAppClient {
  constructor(
    private readonly config: GraphClientConfig,
    private readonly logger: PinoLogger,
  ) {}

  async sendTemplate(
    credentials: WhatsAppCredentials,
    message: WhatsAppTemplateMessage,
  ): Promise<WhatsAppSendResult> {
    const components: unknown[] = [];
    if (message.parameters.length > 0) {
      components.push({
        type: 'body',
        parameters: message.parameters.map((text) => ({ type: 'text', text })),
      });
    }
    // Quick-reply butonları AYRI bileşenlerdir ve her biri kendi indeksini
    // taşır; tek bir bileşende toplanamaz.
    (message.buttonPayloads ?? []).forEach((payload, index) => {
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }],
      });
    });

    const response = await this.post<GraphSendResponse>(credentials, {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    });

    return { messageId: response.messages?.[0]?.id ?? null };
  }

  async sendText(
    credentials: WhatsAppCredentials,
    message: WhatsAppTextMessage,
  ): Promise<WhatsAppSendResult> {
    const response = await this.post<GraphSendResponse>(credentials, {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'text',
      text: { body: message.body, preview_url: false },
    });
    return { messageId: response.messages?.[0]?.id ?? null };
  }

  async listTemplates(
    credentials: WhatsAppCredentials,
    wabaId: string,
  ): Promise<WhatsAppTemplateInfo[]> {
    const url = `${this.config.baseUrl}/${credentials.apiVersion}/${wabaId}/message_templates?limit=200`;
    const payload = await this.request<GraphTemplateResponse>(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    });

    return (payload.data ?? []).map((row) => {
      const body = row.components?.find((component) => component.type === 'BODY');
      const buttons = row.components?.find((component) => component.type === 'BUTTONS');
      return {
        name: row.name ?? '',
        language: row.language ?? 'tr',
        category: row.category ?? null,
        status: GraphWhatsAppClient.templateStatus(row.status),
        bodyVariableCount: GraphWhatsAppClient.countVariables(body?.text ?? ''),
        buttons: (buttons?.buttons ?? []).map((button) => ({
          type: button.type ?? 'QUICK_REPLY',
          text: button.text ?? '',
        })),
      };
    });
  }

  private post<T>(credentials: WhatsAppCredentials, body: unknown): Promise<T> {
    const url = `${this.config.baseUrl}/${credentials.apiVersion}/${credentials.phoneNumberId}/messages`;
    return this.request<T>(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      // Ağ hatası ve zaman aşımı GEÇİCİDİR: sağlayıcı bir dakika sonra
      // ayakta olabilir, mesajı kaybetmenin gerekçesi yok.
      throw new TransientSendError(
        `WhatsApp isteği başarısız: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const payload = text.length > 0 ? (JSON.parse(text) as T & GraphError) : ({} as T & GraphError);

    if (response.ok) return payload;

    const code = payload.error?.code ?? 0;
    const detail = payload.error?.message ?? `HTTP ${response.status}`;
    // Token loga YAZILMAZ: `authorization` başlığı zaten redaction listesinde,
    // burada da hiç aktarılmıyor.
    this.logger.warn({ status: response.status, code }, 'WhatsApp Graph API hatası');

    const permanent = PERMANENT_CODES[code];
    if (permanent !== undefined) throw new PermanentSendError(permanent, detail);
    if (TRANSIENT_CODES.has(code)) {
      throw new TransientSendError(detail, ERROR_CODES.WHATSAPP_RATE_LIMITED);
    }
    if (response.status === 401 || response.status === 403) {
      throw new PermanentSendError(ERROR_CODES.WHATSAPP_NOT_CONFIGURED, detail);
    }
    if (response.status === 429) {
      throw new TransientSendError(detail, ERROR_CODES.WHATSAPP_RATE_LIMITED);
    }
    if (response.status >= 500) throw new TransientSendError(detail);

    // Tanımadığımız 4xx: yeniden denemek aynı sonucu verir.
    throw new PermanentSendError(ERROR_CODES.SERVICE_UNAVAILABLE, detail);
  }

  private static templateStatus(raw: string | undefined): WhatsAppTemplateInfo['status'] {
    switch ((raw ?? '').toUpperCase()) {
      case 'APPROVED':
        return 'approved';
      case 'REJECTED':
      case 'DISABLED':
        return 'rejected';
      default:
        return 'pending';
    }
  }

  private static countVariables(body: string): number {
    return new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1])).size;
  }
}
