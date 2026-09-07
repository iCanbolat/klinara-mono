import {
  CUSTOMER_NOTE_KINDS,
  MEDICAL_NOTE_KINDS,
  PERMISSIONS,
  type CustomerNote,
  type CustomerNoteKind,
} from '@klinara/shared';

/**
 * Hangi not türleri gösterilecek — ve gösterilmeyenler hakkında NE SÖYLENECEK.
 *
 * ---------------------------------------------------------------------------
 * SUNUCUNUN SESSİZLİĞİ
 * ---------------------------------------------------------------------------
 * `notes.service.ts` `customer.medical:read` izni olmayan bir principal'a
 * `treatment` ve `internal` notları **SESSİZCE** eksik döndürüyor: yanıtta
 * "içerik gizlendi" diye bir bayrak yok, satırlar sadece yok.
 *
 * İstemci bu sessizliği kırmak ZORUNDA. Boş bir "Tedavi notları" sekmesi
 * göstermek, resepsiyona **"bu müşterinin tedavi notu yok"** der — ve bu
 * yanlış bilgidir. Kliniğin en hassas verisi hakkında yanlış bilgi.
 *
 * Doğru davranış: sekmeyi HİÇ göstermemek ve yerine bir satır yazmak.
 * "Göremiyorum" ile "yok" arasındaki fark kullanıcıya açıkça söyleniyor.
 */

export interface NoteVisibility {
  /** Kullanıcının görebileceği not türleri. */
  kinds: CustomerNoteKind[];
  /** Tıbbi türler gizlendi mi — açıklama satırı buna bakıyor. */
  medicalHidden: boolean;
  /** Tıbbi not YAZILABİLİR mi (`customer.medical:write`). */
  canWriteMedical: boolean;
}

export function noteVisibility(permissions: readonly string[]): NoteVisibility {
  const canReadMedical = permissions.includes(PERMISSIONS.CUSTOMER_MEDICAL_READ);
  return {
    kinds: canReadMedical
      ? [...CUSTOMER_NOTE_KINDS]
      : CUSTOMER_NOTE_KINDS.filter((kind) => !MEDICAL_NOTE_KINDS.includes(kind)),
    medicalHidden: !canReadMedical,
    canWriteMedical: permissions.includes(PERMISSIONS.CUSTOMER_MEDICAL_WRITE),
  };
}

/**
 * Not yazılabilir mi.
 *
 * `general` için `customer:write`, tıbbi türler için ayrıca
 * `customer.medical:write` gerekiyor (`files.service.ts` ve `notes.service.ts`
 * bunu SERVİSTE zorluyor — rota metadata'sında görünmüyor, dolayısıyla
 * istemcinin bilmesi lazım).
 */
export function canWriteNote(permissions: readonly string[], kind: CustomerNoteKind): boolean {
  if (!permissions.includes(PERMISSIONS.CUSTOMER_WRITE)) return false;
  if (MEDICAL_NOTE_KINDS.includes(kind)) {
    return permissions.includes(PERMISSIONS.CUSTOMER_MEDICAL_WRITE);
  }
  return true;
}

/**
 * Not, biz açtıktan sonra değişmiş mi.
 *
 * ⚠️ `PATCH /notes/:id` `If-Match` İSTEMİYOR: son yazan kazanır (bilinen
 * borç, planda A7). Kilit koyamıyoruz ama SESSİZ KALMAK zorunda da değiliz:
 * kart, notu açarken okunan sürümle sunucudan dönen sürümü karşılaştırıp
 * uyarı basıyor.
 *
 * Bu bir UYARIDIR, kilit değil — kullanıcı yine de üzerine yazabilir. Asıl
 * çözüm sunucuda.
 */
export function isStale(openedVersion: number, current: CustomerNote): boolean {
  return current.version > openedVersion;
}
