/**
 * Tutulan slotun tarayıcıdaki hâli.
 *
 * `sessionStorage` SEÇİLDİ, `localStorage` değil: bir hold sekmeye ait ve
 * ömrü dakikalarla ölçülü. `localStorage` sekme kapandıktan günler sonra ölü
 * bir hold'u geri getirir ve kullanıcı, sunucuda çoktan serbest kalmış bir
 * slotun sayacını izlemeye başlardı.
 *
 * Yine de sunucu OTORİTE: buradaki her değer sunucuya sorulunca doğrulanıyor
 * (`expires_at` her okumada kontrol ediliyor). Bu depo yalnız sayfa
 * yenilemesini atlatmak için.
 */

export interface StoredHold {
  holdToken: string;
  /**
   * Tutmanın hangi SEÇİMLE alındığı.
   *
   * Yalnız token'ı saklamak yetmiyor: sayfa yenilendiğinde sayaç geri gelir
   * ama uygunluk sorgusunun şubesi ve hizmetleri kaybolur — kullanıcı, kendi
   * tuttuğu slotun yanında "eksik alan" hatası görür. Bağlam tutmanın parçası,
   * ayrı bir bilgi değil.
   */
  branchId: string;
  serviceIds: string[];
  staffRef: string | null;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  otpRequired: boolean;
  otpVerified: boolean;
  phone: string | null;
  /**
   * `POST /appointments` için idempotency anahtarı.
   *
   * HOLD'A BAĞLI ve hold yaşadığı sürece DEĞİŞMEZ: kullanıcının çift tıklaması,
   * ağ hatasında yeniden göndermesi ve 5xx retry'ı aynı anahtarı taşımalı ki
   * sunucu tek randevu üretsin. Yeni bir hold = yeni bir niyet = yeni anahtar.
   */
  idempotencyKey: string;
}

const PREFIX = 'klinara:hold:';

function key(slug: string): string {
  return `${PREFIX}${slug}`;
}

export function readHold(slug: string): StoredHold | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key(slug));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredHold(parsed) ? parsed : null;
  } catch {
    // Gizli sekme, kapatılmış site verisi ya da bozuk JSON: hepsinde doğru
    // davranış "hold yok" demek, patlamak değil.
    return null;
  }
}

export function writeHold(slug: string, hold: StoredHold): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key(slug), JSON.stringify(hold));
  } catch {
    // Kota dolu ya da depolama kapalı: akış bellekteki durumla devam eder,
    // yalnız sayfa yenilemesini atlatamaz.
  }
}

export function clearHold(slug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key(slug));
  } catch {
    /* yukarıdaki gerekçe */
  }
}

function isStoredHold(value: unknown): value is StoredHold {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredHold>;
  return (
    typeof candidate.holdToken === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.idempotencyKey === 'string' &&
    typeof candidate.branchId === 'string' &&
    Array.isArray(candidate.serviceIds)
  );
}
