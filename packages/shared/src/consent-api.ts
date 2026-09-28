/**
 * Onam (KVKK aydınlatma / açık rıza) sözleşmesi.
 *
 * Online randevuda TEK zorunlu KVKK onayı alınır: site başına tek belge,
 * sürümlü. Marketing ve photo_usage onamları kapsam dışı.
 *
 * Klinikte ise hasta tablete imza atar (0053): eksikse KVKK metni ve hizmete
 * bağlı işlem onamı şablonları. Bkz. dosyanın sonundaki bölüm.
 */

/** Tek onam türü. Kolon şemada duruyor, ama MVP'de başka değer yok. */
export const CONSENT_KIND = 'kvkk_explicit' as const;
export type ConsentKind = typeof CONSENT_KIND;

export const CONSENT_DOCUMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ConsentDocumentStatus = (typeof CONSENT_DOCUMENT_STATUSES)[number];

/** Gövde sınırı: bir aydınlatma metni 8k'yı rahatlıkla aşar. */
export const CONSENT_LIMITS = {
  body: 20_000,
  templateName: 120,
  signerName: 120,
  /** Base64 çözülmüş imza PNG'si. Bir imza birkaç on KB'ı geçmez. */
  signaturePngBytes: 300_000,
  overrideReason: 500,
  /** `validityDays` üst sınırı (10 yıl). */
  validityDays: 3_650,
} as const;

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

// ---------------------------------------------------------------------------
// Klinikte imzalı onam (işlem onamı + klinik içi KVKK)
// ---------------------------------------------------------------------------

/** İmzalanan belge türü: KVKK metni ya da hizmete bağlı işlem onamı. */
export const SIGNATURE_KINDS = ['kvkk_explicit', 'treatment'] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

/** İmzalayan hastanın kendisi mi, velisi/vasisi mi. */
export const SIGNER_RELATIONS = ['self', 'guardian'] as const;
export type SignerRelation = (typeof SIGNER_RELATIONS)[number];

/** Şablon sürümü. Yayınlanmış gövde değişmez; düzeltme yeni sürümdür. */
export interface ConsentTemplateVersion {
  id: string;
  templateId: string;
  /** Taslakta `null`. */
  version: number | null;
  body: string;
  sha256: string;
  status: ConsentDocumentStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConsentTemplateVersionSummary = Omit<ConsentTemplateVersion, 'body'>;

/** İşlem onamı şablonu — hizmete bağlanır. */
export interface ConsentTemplate {
  id: string;
  name: string;
  /** `null`: her randevuda yeniden imza. N: son N gündeki imza yeterli. */
  validityDays: number | null;
  archived: boolean;
  /** Yayındaki sürüm. `null` ise şablon henüz hiçbir randevuda istenmez. */
  active: ConsentTemplateVersion | null;
  draft: ConsentTemplateVersion | null;
  /** Bu şablonu isteyen hizmetler. */
  serviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateConsentTemplateInput {
  name: string;
  validityDays?: number | null;
  /** Verilirse ilk taslak olarak kaydedilir. */
  body?: string;
}

export interface UpdateConsentTemplateInput {
  name?: string;
  validityDays?: number | null;
}

export interface UpdateConsentTemplateDraftInput {
  body: string;
}

export interface SetServiceConsentTemplatesInput {
  templateIds: string[];
}

/** İmza modunda hastaya gösterilecek belge. */
export interface SignableConsentDocument {
  kind: SignatureKind;
  /** KVKK için `consent_documents.id`, işlem onamı için şablon SÜRÜMÜ id'si. */
  documentId: string;
  title: string;
  version: number;
  body: string;
  /** İmza isteği bunu aynen geri gönderir; metin arada değiştiyse 409. */
  sha256: string;
}

export interface ConsentRequirementItem {
  kind: SignatureKind;
  /** İşlem onamında şablon id'si; KVKK'da `null`. */
  templateId: string | null;
  title: string;
  satisfied: boolean;
  /** Gereksinimi karşılayan imza (klinik içi). Online kabulde `null`. */
  signatureId: string | null;
  /** Karşılanmamışsa imzalanacak belge. */
  document: SignableConsentDocument | null;
}

export interface ConsentRequirements {
  appointmentId: string | null;
  customerId: string;
  customerName: string;
  /** Önce KVKK, ardından hizmet sırasıyla işlem onamları. */
  items: ConsentRequirementItem[];
  missingCount: number;
}

/**
 * Randevu listesinde onam rozeti.
 *
 * `none`: bu randevu için istenen bir onam yok.
 */
export const APPOINTMENT_CONSENT_STATUSES = ['ok', 'missing', 'none'] as const;
export type AppointmentConsentStatus = (typeof APPOINTMENT_CONSENT_STATUSES)[number];

export interface CreateConsentSignatureInput {
  kind: SignatureKind;
  documentId: string;
  /** Hastaya gösterilen metnin hash'i (`SignableConsentDocument.sha256`). */
  textSha256: string;
  signerName: string;
  signerRelation: SignerRelation;
  /** `guardian` ise hastanın adı. */
  guardianOfName?: string;
  /** `data:image/png;base64,...` ya da çıplak base64. */
  signaturePng: string;
}

export interface ConsentSignatureSummary {
  id: string;
  kind: SignatureKind;
  documentTitle: string;
  documentVersion: number;
  signerName: string;
  signerRelation: SignerRelation;
  guardianOfName: string | null;
  customerId: string | null;
  appointmentId: string | null;
  collectedBy: { id: string; name: string } | null;
  signedAt: string;
  textSha256: string;
  pdfSha256: string;
}

export interface ConsentSignature extends ConsentSignatureSummary {
  text: string;
  signatureSha256: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ConsentPdfUrl {
  url: string;
  expiresAt: string;
}
