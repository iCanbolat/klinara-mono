import type {
  ConsentRequirements,
  CreateConsentSignatureInput,
  SignableConsentDocument,
  SignerRelation,
} from '@klinara/shared';

/**
 * İmza modunun saf kuralları — bileşenden ayrı, çünkü "ne zaman
 * onaylanabilir" sorusu bir KANIT kuralıdır ve testle sabitlenmeli.
 */

export interface SignerForm {
  signerName: string;
  relation: SignerRelation;
  guardianOfName: string;
  acknowledged: boolean;
  /** Metin sonuna kadar kaydırıldı mı (ya da hiç kaydırma gerekmiyor mu). */
  scrolledToEnd: boolean;
  /** İmza alanında mürekkep var mı. */
  hasInk: boolean;
}

export function initialForm(customerName: string, relation: SignerRelation = 'self'): SignerForm {
  return {
    signerName: relation === 'self' ? customerName : '',
    relation,
    guardianOfName: relation === 'guardian' ? customerName : '',
    acknowledged: false,
    scrolledToEnd: false,
    hasInk: false,
  };
}

/**
 * Formu yeni belgeye taşır: kimlik bilgisi KORUNUR (hasta ikinci belgede
 * adını yeniden yazmasın), onay, okuma ve imza SIFIRLANIR — her belge ayrı
 * okunup ayrı imzalanır.
 */
export function nextDocumentForm(previous: SignerForm): SignerForm {
  return { ...previous, acknowledged: false, scrolledToEnd: false, hasInk: false };
}

/** İlişki değişince ad alanlarının anlamı değişir: hastanın adı doğru alana taşınır. */
export function withRelation(
  form: SignerForm,
  relation: SignerRelation,
  customerName: string,
): SignerForm {
  if (form.relation === relation) return form;
  return relation === 'guardian'
    ? { ...form, relation, signerName: '', guardianOfName: customerName }
    : { ...form, relation, signerName: customerName, guardianOfName: '' };
}

const MIN_NAME = 2;

export function canSubmit(form: SignerForm): boolean {
  if (!form.scrolledToEnd || !form.acknowledged || !form.hasInk) return false;
  if (form.signerName.trim().length < MIN_NAME) return false;
  if (form.relation === 'guardian' && form.guardianOfName.trim().length < MIN_NAME) return false;
  return true;
}

/** İmzalanacak belgeler, sunucunun verdiği sırayla (önce KVKK). */
export function pendingDocuments(requirements: ConsentRequirements): SignableConsentDocument[] {
  return requirements.items
    .filter((item) => !item.satisfied)
    .map((item) => item.document)
    .filter((document): document is SignableConsentDocument => document !== null);
}

export function signatureInput(
  document: SignableConsentDocument,
  form: SignerForm,
  signaturePng: string,
): CreateConsentSignatureInput {
  return {
    kind: document.kind,
    documentId: document.documentId,
    textSha256: document.sha256,
    signerName: form.signerName.trim(),
    signerRelation: form.relation,
    ...(form.relation === 'guardian' ? { guardianOfName: form.guardianOfName.trim() } : {}),
    signaturePng,
  };
}

/** Kaydırma payı: alt kenara birkaç piksel kalması "sona geldi" sayılır. */
const SCROLL_SLACK_PX = 8;

export function isScrolledToEnd(metrics: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - SCROLL_SLACK_PX;
}

/**
 * İmza sonrası dönüş adresi. Yalnız uygulama İÇİ göreli yol kabul edilir —
 * sorgu dizgesinden gelen değer açık yönlendirme olmasın.
 */
export function safeReturnPath(value: string | null, fallback: string): string {
  if (value === null) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}
