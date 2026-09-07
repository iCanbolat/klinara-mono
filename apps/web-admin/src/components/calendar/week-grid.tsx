'use client';

import { useMemo, type ReactNode } from 'react';
import type { DensityBucket } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { addDays, formatDayLabel, type DayKey } from '@/lib/calendar/date';

/**
 * Hafta görünümü — randevu blokları DEĞİL, yoğunluk ısı haritası.
 *
 * ---------------------------------------------------------------------------
 * NEDEN BLOK ÇİZİLMİYOR
 * ---------------------------------------------------------------------------
 * Yedi gün × N personel × günde onlarca randevuyu tek ekrana blok olarak
 * çizmek okunamaz bir şey üretir: bloklar birkaç piksel yüksekliğe düşer,
 * müşteri adı sığmaz ve şerit yerleşimi görsel gürültüye dönüşür.
 *
 * Haftanın gerçek sorusu "hangi gün ne kadar dolu" — ve sunucu bunu ZATEN
 * hesaplayıp `density[]` olarak gönderiyor (`CalendarResponse.density`).
 * Hücreye tıklamak o günün ızgarasına götürüyor; ayrıntı orada.
 */

export interface WeekGridProps {
  weekStart: DayKey;
  density: readonly DensityBucket[];
  onPickDay: (day: DayKey) => void;
}

/** Isı haritasının saat aralığı; dışındaki saatler satır olarak çizilmiyor. */
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

export function WeekGrid({ weekStart, density, onPickDay }: WeekGridProps): ReactNode {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const { counts, max } = useMemo(() => {
    const map = new Map<string, number>();
    let peak = 0;
    for (const bucket of density) {
      const key = `${bucket.localDay}|${String(bucket.localHour)}`;
      const next = (map.get(key) ?? 0) + bucket.appointmentCount;
      map.set(key, next);
      if (next > peak) peak = next;
    }
    return { counts: map, max: peak };
  }, [density]);

  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

  if (max === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('calendar.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-separate border-spacing-0.5">
        <caption className="sr-only">{t('calendar.week')}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-12">
              <span className="sr-only">Saat</span>
            </th>
            {days.map((day) => (
              <th key={day} scope="col" className="px-1 pb-2 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="w-full truncate rounded-lg px-1 py-1 transition-colors hover:bg-accent"
                >
                  {formatDayLabel(day)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour) => (
            <tr key={hour}>
              <th scope="row" className="pr-2 text-right text-xs tabular-nums text-muted-foreground">
                {String(hour).padStart(2, '0')}
              </th>
              {days.map((day) => {
                const count = counts.get(`${day}|${String(hour)}`) ?? 0;
                return (
                  <td key={day} className="p-0">
                    <button
                      type="button"
                      onClick={() => onPickDay(day)}
                      // Sayı hem renkte hem METİNDE: yalnız renge dayanmak,
                      // renk körlüğü olan bir kullanıcıya hiçbir şey söylemez.
                      aria-label={`${formatDayLabel(day)} ${String(hour)}:00 — ${String(count)} randevu`}
                      className={cn(
                        'h-7 w-full rounded text-[11px] tabular-nums transition-colors',
                        count === 0 ? 'bg-muted/40 text-transparent' : 'text-foreground',
                      )}
                      style={
                        count === 0
                          ? undefined
                          : {
                              // Doygunluk en yoğun hücreye göre; sabit bir
                              // eşik, sakin bir klinikte her şeyi soluk,
                              // yoğun bir klinikte her şeyi koyu gösterirdi.
                              backgroundColor: `color-mix(in oklab, var(--primary) ${String(
                                Math.round((count / max) * 70) + 15,
                              )}%, white)`,
                            }
                      }
                    >
                      {count === 0 ? '0' : count}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
