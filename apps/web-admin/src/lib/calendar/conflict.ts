import { ERROR_CODES } from '@klinara/shared';
import { ApiProblemError } from '@/lib/api/client';

/**
 * `409 SLOT_CONFLICT` gövdesinin tipli okunması.
 *
 * ---------------------------------------------------------------------------
 * NEDEN ÖNEMLİ
 * ---------------------------------------------------------------------------
 * Bu hata bir istisna değil, RANDEVU ALMANIN NORMAL BİR SONUCU: iki resepsiyon
 * aynı slota aynı anda yazmaya çalışır ve veritabanı birini reddeder. Doğru
 * yanıt kullanıcıya "hata" demek değil, **sunucunun ZATEN hesapladığı
 * alternatif saatleri** göstermek.
 *
 * Sunucu (`appointments.service.ts:841`) gövdeye iki şey koyuyor:
 *   `conflicts`   — çakışan kaynak ve aralığı (teşhis; "kim tutuyor")
 *   `suggestions` — uygunluk motorundan gelen, o gün içindeki en yakın
 *                   alternatifler. Boş olabilir: üretimi `.catch(() => [])`
 *                   ile korunuyor, yani çakışma bilgisi kaybolmasın diye
 *                   öneri üretimi başarısız olsa bile hata yine dönüyor.
 *
 * Bu yüzden `suggestions` BOŞ GELEBİLİR ve arayüz bunu bir son olarak değil
 * bir dallanma olarak ele almalı: öneri yoksa uygunluk yeniden sorgulanır.
 *
 * Gövde sunucudan geliyor ama `unknown` muamelesi görüyor — alanlar eksikse
 * boş diziye düşülüyor. Bir teşhis alanı yüzünden randevu ekranının patlaması,
 * çakışmanın kendisinden kötü olurdu.
 */

export interface SlotConflictEntry {
  resourceType: string;
  resourceId: string;
  appointmentId: string | null;
  from: string;
  to: string;
}

export interface SlotSuggestion {
  startsAt: string;
  endsAt: string;
  staffProfileIds: string[];
}

export interface SlotConflict {
  conflicts: SlotConflictEntry[];
  suggestions: SlotSuggestion[];
}

const EMPTY: SlotConflict = { conflicts: [], suggestions: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readSuggestions(value: unknown): SlotSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SlotSuggestion[] => {
    if (!isRecord(item)) return [];
    const startsAt = readString(item, 'startsAt');
    const endsAt = readString(item, 'endsAt');
    // Saat olmadan bir öneri düğmesi çizilemez; eksik kayıt atlanıyor.
    if (startsAt === null || endsAt === null) return [];
    const staff = item['staffProfileIds'];
    return [
      {
        startsAt,
        endsAt,
        staffProfileIds: Array.isArray(staff)
          ? staff.filter((id): id is string => typeof id === 'string')
          : [],
      },
    ];
  });
}

function readConflicts(value: unknown): SlotConflictEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SlotConflictEntry[] => {
    if (!isRecord(item)) return [];
    const from = readString(item, 'from');
    const to = readString(item, 'to');
    if (from === null || to === null) return [];
    return [
      {
        resourceType: readString(item, 'resourceType') ?? 'staff',
        resourceId: readString(item, 'resourceId') ?? '',
        appointmentId: readString(item, 'appointmentId'),
        from,
        to,
      },
    ];
  });
}

/**
 * Yakalanan hata bir slot çakışmasıysa içeriğini çıkarır, değilse `null`.
 *
 * `null` dönmesi "çakışma değil" demek; çağıran o zaman olağan hata metnine
 * düşer. Boş bir `SlotConflict` dönmek yanlış olurdu — "çakışma var ama
 * bilgi yok" ile "çakışma yok" aynı şey değil.
 */
export function readSlotConflict(caught: unknown): SlotConflict | null {
  if (!(caught instanceof ApiProblemError)) return null;
  if (caught.code !== ERROR_CODES.SLOT_CONFLICT) return null;

  const problem = caught.problem as unknown;
  if (!isRecord(problem)) return EMPTY;

  return {
    conflicts: readConflicts(problem['conflicts']),
    suggestions: readSuggestions(problem['suggestions']),
  };
}
