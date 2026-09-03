import type { ContentDocumentInput } from '@klinara/shared';

/**
 * Kaydedilmemiş taslağın kurtarılması — saf.
 *
 * KABUL KRİTERİNİN İKİNCİ YARISI: oturum bittiğinde kullanıcı verisini
 * kaybetmemeli. `SessionExpiredDialog` çoğu durumu modal içinde çözüyor ve
 * ağaç hiç unmount olmuyor; ama çok adımlı yeniden giriş (kiracı seçimi, MFA)
 * tam sayfa gezinme gerektiriyor ve orada React durumu ölüyor. Bu modül o
 * ihtimal içindir.
 *
 * `sessionStorage`, `localStorage` DEĞİL: kurtarma yalnız o sekmenin oturumu
 * boyunca anlamlı. `localStorage` olsaydı kullanıcı haftalar sonra açtığı bir
 * sekmede, çoktan yayınlanmış içeriğin üzerine eski bir taslağı geri yüklemeyi
 * teklif eden bir şerit görürdü.
 */

const KEY_PREFIX = 'klinara:draft:';

export interface StoredDraft {
  document: ContentDocumentInput;
  /** Taslak kaydedildiğinde yüklenmiş olan sürümün hash'i. */
  baseContentHash: string | null;
  savedAt: number;
}

function key(pageId: string): string {
  return `${KEY_PREFIX}${pageId}`;
}

/** Yazma HER ZAMAN try/catch içinde: gizli sekmede `sessionStorage` fırlatır. */
export function saveDraft(pageId: string, draft: StoredDraft): void {
  try {
    sessionStorage.setItem(key(pageId), JSON.stringify(draft));
  } catch {
    // Kurtarma bir kolaylık; yazamamak akışı durdurmamalı.
  }
}

export function readDraft(pageId: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(key(pageId));
    if (raw === null) return null;
    return parseDraft(raw);
  } catch {
    return null;
  }
}

export function clearDraft(pageId: string): void {
  try {
    sessionStorage.removeItem(key(pageId));
  } catch {
    // yok say
  }
}

/**
 * Ham dizeyi güvenle çöz.
 *
 * Çalışma zamanı tip kontrolü var çünkü `sessionStorage` kullanıcının
 * düzenleyebildiği bir yer ve bozuk bir kayıt editörü çökertmemeli.
 */
export function parseDraft(raw: string): StoredDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const candidate = parsed as Partial<StoredDraft>;
  const document: ContentDocumentInput | undefined = candidate.document;
  if (typeof document !== 'object' || document === null) return null;
  if (!Array.isArray(document.sections)) return null;
  if (typeof candidate.savedAt !== 'number') return null;

  return {
    document,
    baseContentHash:
      typeof candidate.baseContentHash === 'string' ? candidate.baseContentHash : null,
    savedAt: candidate.savedAt,
  };
}

/**
 * Saklanan taslak geri yüklenmeli mi?
 *
 * ⚠️ Hash EŞİTSE geri YÜKLENMİYOR ve bu ters gibi görünebilir. Gerekçe: eşitlik,
 * sunucudaki taslağın kullanıcının bıraktığı yerle aynı olduğu anlamına gelir —
 * yani değişiklik zaten kaydedilmiş, geri yüklenecek bir şey yok. Bu durumda
 * şerit göstermek kullanıcıyı olmayan bir kayıp konusunda endişelendirirdi.
 *
 * Hash FARKLIYSA saklanan sürüm, sunucudakinden ayrışmış demektir: ya kullanıcı
 * kaydetmeden kaybetti ya da başka biri araya kaydetti. İkisinde de doğru
 * davranış, kullanıcıya sorup KARARI ona bırakmak.
 */
export function shouldRestore(stored: StoredDraft | null, loadedContentHash: string | null): boolean {
  if (stored === null) return false;
  if (stored.baseContentHash === null) return true;
  return stored.baseContentHash !== loadedContentHash;
}
