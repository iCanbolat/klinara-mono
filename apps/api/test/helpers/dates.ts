/**
 * Fixture tarihleri — duvar saatinden BAĞIMSIZ.
 *
 * Takvim gününü sabit yazmak (`2026-09-07` gibi) testi duvar saatine bağlar:
 * o gün gelip çattığında uygunluk motorunun min-lead penceresi ve self-servis
 * iptal penceresi beklenen slotları eler, `toHaveLength(35)` 4'e düşer, iptal
 * 409 döner. Üstelik gün ilerledikçe sayı da kayar; test kodda hiçbir şey
 * değişmeden önce kırmızıya, sonra tekrar yeşile döner.
 *
 * Çözüm: hedef günü HER ZAMAN bugünden ileriye hesaplamak. Motorun kendisi
 * `now()` ile çalıştığı (Postgres tarafında, bkz. availability.repository.ts)
 * ve enjekte edilebilir bir saat soyutlaması bulunmadığı için sahte zamanlayıcı
 * bir çare değil — fixture'ın kayması gerekiyor.
 */

const DAY_MS = 86_400_000;

/** Istanbul kalıcı UTC+3; yerel takvim gününü UTC'yi kaydırarak buluyoruz. */
const ISTANBUL_OFFSET_MS = 3 * 3_600_000;

const toIsoDay = (shiftedMs: number): string => new Date(shiftedMs).toISOString().slice(0, 10);

const fromIsoDay = (isoDay: string): number => Date.parse(`${isoDay}T00:00:00Z`);

/**
 * Bugünden en az `minDaysAhead` gün sonraki ilk Pazartesi (Istanbul yerel günü).
 *
 * Varsayılan 21 gün: min-lead penceresinin çok ötesinde, kiracının varsayılan
 * `maxAdvanceDays` (180) sınırının ise rahatça içinde.
 */
export function upcomingMonday(minDaysAhead = 21): string {
  const istanbulNow = Date.now() + ISTANBUL_OFFSET_MS;
  const base = Math.floor(istanbulNow / DAY_MS) * DAY_MS + minDaysAhead * DAY_MS;
  const forward = (1 - new Date(base).getUTCDay() + 7) % 7; // 1 = Pazartesi
  return toIsoDay(base + forward * DAY_MS);
}

/** `isoDay`'den `days` gün ötesi/berisi (negatif değer geriye gider). */
export function shiftDays(isoDay: string, days: number): string {
  return toIsoDay(fromIsoDay(isoDay) + days * DAY_MS);
}

/**
 * Berlin'de saatlerin geri alındığı ilk GELECEK gün: Ekim'in son Pazarı
 * (CEST +02:00 → CET +01:00). DST testi gerçek bir geçiş gününe muhtaç.
 */
export function upcomingBerlinDstFallback(minDaysAhead = 7): string {
  const earliest = Date.now() + ISTANBUL_OFFSET_MS + minDaysAhead * DAY_MS;
  for (let year = new Date(earliest).getUTCFullYear(); ; year += 1) {
    const lastOctober = Date.UTC(year, 9, 31);
    const sunday = lastOctober - new Date(lastOctober).getUTCDay() * DAY_MS;
    if (sunday >= earliest) return toIsoDay(sunday);
  }
}
