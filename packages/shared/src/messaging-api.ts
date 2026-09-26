/**
 * WhatsApp entegrasyonu ve sohbetler — `apps/web-admin`'in sözleşmesi.
 *
 * `apps/api/src/modules/integrations/dto/{whatsapp,conversation}.dto.ts`
 * sınıflarının aynadaki karşılığı; `apps/api/test/unit/admin-api-contract.test.ts`
 * ikisinin ayrışmasını derleme zamanında yakalar.
 */

import type { Page } from './clinic-api.js';

// ---------------------------------------------------------------------------
// Entegrasyon
// ---------------------------------------------------------------------------

export const WHATSAPP_ACCOUNT_STATUSES = ['unconfigured', 'active', 'error'] as const;
export type WhatsAppAccountStatus = (typeof WHATSAPP_ACCOUNT_STATUSES)[number];

export type WhatsAppTemplateStatus = 'pending' | 'approved' | 'rejected';

export interface WhatsAppAccount {
  wabaId: string;
  phoneNumberId: string;
  businessPhone: string | null;
  apiVersion: string;
  status: string;
  /** Token HİÇBİR yanıtta dönmez — yalnız son 4 hane. */
  accessTokenMasked: string;
  hasAppSecret: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

export interface UpsertWhatsAppAccountInput {
  wabaId: string;
  phoneNumberId: string;
  businessPhone?: string;
  /** Her kayıtta yeniden girilir — kayıtlı değer okunamaz. */
  accessToken: string;
  /** Verilmezse kayıtlı değer KORUNUR. */
  appSecret?: string;
  apiVersion?: string;
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string | null;
  status: string;
  bodyVariableCount: number;
  /** BODY metni `{{1}}` yer tutucularıyla; senkronizasyondan önce boş. */
  bodyText: string | null;
  buttons: { type: string; text: string }[];
  syncedAt: string | null;
}

export interface WhatsAppVerifyResult {
  ok: boolean;
  error: string | null;
  templateCount: number;
}

export interface WhatsAppProvisionItem {
  name: string;
  outcome: 'created' | 'exists' | 'failed';
  status: WhatsAppTemplateStatus | null;
  error: string | null;
}

export interface WhatsAppProvisionResult {
  results: WhatsAppProvisionItem[];
  created: number;
  failed: number;
}

export interface WhatsAppTestSendInput {
  to: string;
  templateName: string;
  templateLanguage?: string;
}

export interface WhatsAppTestResult {
  accepted: boolean;
  providerMessageId: string | null;
}

/**
 * Kurulum ekranının gösterdiği webhook yolu. Alan adı API'nin herkese açık
 * adresi — panel onu bilmiyor ve bilmemeli (bkz. `lib/api/client.ts`).
 */
export const WHATSAPP_WEBHOOK_PATH = '/api/v1/webhooks/whatsapp';

// ---------------------------------------------------------------------------
// Sohbetler
// ---------------------------------------------------------------------------

export type ConversationStatus = 'open' | 'closed';
export type ConversationStatusFilter = ConversationStatus | 'all';

export interface Conversation {
  id: string;
  /** E.164 — kayıtlı olmayan bir numara da olabilir. */
  phone: string;
  customer: { id: string; fullName: string } | null;
  status: ConversationStatus;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastMessageDirection: 'in' | 'out' | null;
  unread: boolean;
  /** 24 saatlik pencere açık mı — kapalıyken serbest metin gönderilemez. */
  windowOpen: boolean;
  windowExpiresAt: string | null;
}

export type ConversationPage = Page<Conversation>;

export interface ConversationMessage {
  id: string;
  direction: 'in' | 'out';
  /** Gelen: `text`, `button`, `image`…; giden: `text` ya da `template`. */
  type: string;
  body: string | null;
  createdAt: string;
  /** Yalnız giden: queued, sending, sent, delivered, read, failed, skipped. */
  status: string | null;
  event: string | null;
  sentByName: string | null;
  errorDetail: string | null;
  appointmentId: string | null;
}

export interface ConversationDetail {
  conversation: Conversation;
  /** Son 200 mesaj, eskiden yeniye. */
  messages: ConversationMessage[];
}

export interface SendConversationMessageInput {
  body: string;
}

export interface LinkConversationCustomerInput {
  customerId: string;
}

/**
 * Pencere kapalıyken sohbete gönderilebilecek şablon: Meta'da onaylı,
 * butonsuz ve işlemsel (UTILITY). Pazarlama şablonu ürünün kapsamı dışında.
 */
export interface ConversationTemplateOption {
  name: string;
  language: string;
  category: 'UTILITY';
  /** `{{1}}` yer tutucularıyla gövde — önizleme için. */
  bodyText: string;
  bodyVariableCount: number;
  /** Değişkenlerin adları (`customerName`…), bilinmiyorsa `null`. */
  variableNames: (string | null)[];
  /** Önerilen değerler, konum sırasıyla; öneri yoksa boş metin. */
  suggestedParameters: string[];
}

export interface SendConversationTemplateInput {
  templateName: string;
  language: string;
  /** Konumsal parametreler; sayısı şablonun değişken sayısına eşit olmalı. */
  parameters: string[];
}
