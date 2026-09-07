/**
 * Onam (KVKK aydınlatma / açık rıza) sözleşmesi.
 *
 * Faz 7 TEK zorunlu KVKK onayına daraltıldı: treatment onamı klinik içi ayrı
 * bir akışa taşındı (MVP dışı), marketing ve photo_usage onamları MVP'den
 * çıktı. Bu yüzden burada bir "tür" sayacı yok — tek belge, sürümlü.
 */

/** Tek onam türü. Kolon şemada duruyor, ama MVP'de başka değer yok. */
export const CONSENT_KIND = 'kvkk_explicit' as const;
export type ConsentKind = typeof CONSENT_KIND;

export const CONSENT_DOCUMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ConsentDocumentStatus = (typeof CONSENT_DOCUMENT_STATUSES)[number];

/** Gövde sınırı: bir aydınlatma metni 8k'yı rahatlıkla aşar. */
export const CONSENT_LIMITS = { body: 20_000 } as const;

export interface ConsentDocument {
  id: string;
  kind: ConsentKind;
  /** Taslakta `null` — sürüm numarası yayın anında, kilit altında verilir. */
  version: number | null;
  locale: string;
  body: string;
  /** Sunucu hesaplar. Public uç bunu döner, istemci aynen geri gönderir. */
  sha256: string;
  status: ConsentDocumentStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sürüm listesinde gövde YOK: liste ekranı 20k'lık metinleri taşımamalı. */
export type ConsentDocumentSummary = Omit<ConsentDocument, 'body'>;

export interface ConsentDocumentState {
  /** Yayındaki metin. `null` ise site yayınlanamaz. */
  active: ConsentDocument | null;
  /** Düzenlenmekte olan taslak. Site başına en fazla bir tane. */
  draft: ConsentDocument | null;
}

export interface UpdateConsentDraftInput {
  body: string;
  locale?: string;
}

/**
 * Kabul kanıtı.
 *
 * Metnin BİREBİR kopyası burada duruyor: yayındaki metin yarın yeni bir sürüme
 * geçse bile "bu müşteriye ne gösterildi" cevaplanabilir kalıyor. Kayıt
 * değişmez — sonradan düzeltilebilen bir onam kanıtı, kanıt değildir.
 */
export interface ConsentAcceptance {
  id: string;
  appointmentId: string | null;
  customerId: string | null;
  kind: string;
  /** 0043 öncesi satırlarda `null`; kanıt yine de `text` + `textSha256` ile tam. */
  version: number | null;
  locale: string | null;
  text: string;
  textSha256: string;
  acceptedAt: string;
  ip: string | null;
  userAgent: string | null;
}
