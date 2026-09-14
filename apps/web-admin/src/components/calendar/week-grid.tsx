'use client';

import { useMemo, type ReactNode } from 'react';
import type { CalendarEntry, DensityBucket } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import {
  daysFrom,
  dayKeyOf,
  formatDayLabel,
  formatDayShort,
  minutesOfDay,
  type DayKey,
} from '@/lib/calendar/date';
import {
  densityKey,
  densityMap,
  gridWindow,
  groupByDay,
  positionEntries,
  windowHours,
} from '@/lib/calendar/grid';
import { AppointmentBlock } from './appointment-block';
import { HourAxis, HourLines, NowLine } from './day-grid';
import { useNow } from './use-now';

/**
 * Hafta ızgarası — yedi gün sütunu, ortak saat ekseni, randevu blokları.
 *
 * iOS `WeekGridView` ile aynı model. Önceki sürüm yalnız bir yoğunluk tablosu
 * çiziyordu ("hangi gün ne kadar dolu"); ama randevu önerirken asıl soru
 * "bu hafta NEREYE sığar" ve bu, boşluğu bloklar arasında görmeden
 * cevaplanamıyor.
 *
 * Sunucunun `density[]`i ızgaranın ARKASINA boyanıyor. Ayrı bir tablo ısıyı
 * ızgaranın hizasından koparırdı: "salı 14:00 yoğun" bilgisi ancak o hücrenin
 * kendisinde işe yarıyor.
 *
 * ---------------------------------------------------------------------------
 * GENİŞLİK
 * ---------------------------------------------------------------------------
 * `md` üstünde yedi sütun kaba sığdırılıyor. Altında 40rem tabanla yatay
 * kaydırılıyor: 7 × ~45px sütunda blok bir renk şeridinden ibaret kalıyor.
 * Telefonda varsayılan görünüm zaten ajanda (`calendar-page.tsx`).
 */

const PX_PER_MINUTE = 0.8;

export interface WeekGridProps {
  weekStart: DayKey;
  entries: readonly CalendarEntry[];
  density: readonly DensityBucket[];
  timezone: string;
  /** Personel süzgeci açık mı — yoğunluk sunucuda süzülmüyor, not düşülüyor. */
  staffFiltered?: boolean;
  onSelect: (entry: CalendarEntry) => void;
  onPickDay: (day: DayKey) => void;
}

export function WeekGrid({
  weekStart,
  entries,
  density,
  timezone,
  staffFiltered = false,
  onSelect,
  onPickDay,
}: WeekGridProps): ReactNode {
  const now = useNow();
  const days = useMemo(() => daysFrom(weekStart, 7), [weekStart]);

  const { columns, window, heat } = useMemo(() => {
    const byDay = groupByDay(entries, timezone, days);
    const cols = days.map((day) => {
      const list = byDay.get(day) ?? [];
      return { day, count: list.length, rows: positionEntries(list, timezone) };
    });
    return {
      columns: cols,
      window: gridWindow(cols.flatMap((col) => col.rows)),
      heat: densityMap(density),
    };
  }, [entries, density, timezone, days]);

  const height = (window.end - window.start) * PX_PER_MINUTE;
  const hours = windowHours(window);
  const nowIso = new Date(now).toISOString();
  const today = dayKeyOf(nowIso, timezone);
  const nowMin = minutesOfDay(nowIso, timezone);

  return (
    <div className="flex flex-col gap-2">
      {heat.peak > 0 ? (
        <DensityLegend
          peak={heat.peak}
          note={staffFiltered ? t('calendar.densityUnfiltered') : null}
        />
      ) : null}

      <div className="overflow-x-auto">
        <div className="min-w-[40rem] md:min-w-0">
          {/* Gün başlıkları — saat ekseniyle aynı sol boşluk */}
          <div className="sticky top-0 z-20 flex gap-1 bg-card pb-2 sm:gap-2">
            <div className="w-10 shrink-0 sm:w-14" aria-hidden="true" />
            <div className="grid flex-1 grid-cols-7 gap-px">
              {columns.map(({ day, count }) => {
                const short = formatDayShort(day);
                const isToday = day === today;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onPickDay(day)}
                    aria-label={`${formatDayLabel(day)} — ${t('calendar.appointmentCount', { count })}`}
                    aria-current={isToday ? 'date' : undefined}
                    className={cn(
                      'flex flex-col items-center rounded-lg px-1 py-1 text-xs transition-colors hover:bg-accent',
                      isToday && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="text-muted-foreground">{short.weekday}</span>
                    <span
                      className={cn(
                        'text-base font-semibold tabular-nums',
                        isToday && 'text-primary',
                      )}
                    >
                      {short.day}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {count === 0 ? '—' : count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-1 pt-2 sm:gap-2">
            <HourAxis
              hours={hours}
              windowStart={window.start}
              height={height}
              pxPerMinute={PX_PER_MINUTE}
            />
            <div
              className="relative grid flex-1 grid-cols-7 overflow-hidden rounded-lg border border-border"
              style={{ height }}
            >
              {columns.map(({ day, rows }, index) => (
                <div key={day} className={cn('relative', index > 0 && 'border-l border-border/60')}>
                  {hours.slice(0, -1).map((minute) => {
                    const count = heat.counts.get(densityKey(day, minute / 60)) ?? 0;
                    if (count === 0) return null;
                    return (
                      <div
                        key={minute}
                        aria-hidden="true"
                        className="absolute inset-x-0"
                        style={{
                          top: (minute - window.start) * PX_PER_MINUTE,
                          height: 60 * PX_PER_MINUTE,
                          // Doygunluk en yoğun hücreye göre; sabit bir eşik,
                          // sakin bir klinikte her şeyi soluk, yoğun bir
                          // klinikte her şeyi koyu gösterirdi.
                          backgroundColor: `color-mix(in oklab, var(--primary) ${String(
                            Math.round((count / heat.peak) * 22) + 4,
                          )}%, transparent)`,
                        }}
                      />
                    );
                  })}
                  <HourLines hours={hours} windowStart={window.start} pxPerMinute={PX_PER_MINUTE} />
                  {rows.map((row) => (
                    <AppointmentBlock
                      key={row.entry.id}
                      row={row}
                      windowStart={window.start}
                      pxPerMinute={PX_PER_MINUTE}
                      timezone={timezone}
                      compact
                      onSelect={onSelect}
                    />
                  ))}
                  {day === today && nowMin >= window.start && nowMin <= window.end ? (
                    <NowLine top={(nowMin - window.start) * PX_PER_MINUTE} />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">{t('calendar.empty')}</p>
      ) : null}
    </div>
  );
}

function DensityLegend({ peak, note }: { peak: number; note: string | null }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {t('calendar.densityLegend')}
        <span
          aria-hidden="true"
          className="h-2.5 w-16 rounded-full"
          style={{
            background:
              'linear-gradient(to right, color-mix(in oklab, var(--primary) 4%, transparent), color-mix(in oklab, var(--primary) 26%, transparent))',
          }}
        />
        <span className="tabular-nums">{t('calendar.densityPeak', { count: peak })}</span>
      </span>
      {note === null ? null : <span>{note}</span>}
    </div>
  );
}
