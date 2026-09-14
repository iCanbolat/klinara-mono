'use client';

import { useMemo, type ReactNode } from 'react';
import type { CalendarEntry } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { dayKeyOf, minutesOfDay, type DayKey } from '@/lib/calendar/date';
import { gridWindow, positionEntries, windowHours } from '@/lib/calendar/grid';
import { AppointmentBlock } from './appointment-block';
import { useNow } from './use-now';

/**
 * Gün ızgarası — dakika başına piksel, `position: absolute` bloklar.
 *
 * Kütüphane kullanılmadı; gerekçe `lib/calendar/layout.ts` başlığında. Konum ve
 * pencere hesabı `lib/calendar/grid.ts`te, saf ve test edilmiş hâlde duruyor
 * (hafta ızgarası da aynısını kullanıyor). Bu dosya yalnız çiziyor.
 *
 * Genişlik tabanı YOK: ızgara kabın genişliğini alıyor. Eski `min-w-[18rem]`
 * dar bir telefonda saat sütunuyla birlikte ekranı taşırıp sayfayı yatay
 * kaydırıyordu.
 */

const PX_PER_MINUTE = 1.1;

export interface DayGridProps {
  day: DayKey;
  entries: readonly CalendarEntry[];
  timezone: string;
  onSelect: (entry: CalendarEntry) => void;
}

export function DayGrid({ day, entries, timezone, onSelect }: DayGridProps): ReactNode {
  const now = useNow();
  const { positioned, window } = useMemo(() => {
    const rows = positionEntries(entries, timezone);
    return { positioned: rows, window: gridWindow(rows) };
  }, [entries, timezone]);

  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('calendar.empty')}</p>;
  }

  const height = (window.end - window.start) * PX_PER_MINUTE;
  const hours = windowHours(window);
  const nowIso = new Date(now).toISOString();
  const nowMin = dayKeyOf(nowIso, timezone) === day ? minutesOfDay(nowIso, timezone) : null;

  return (
    <div className="flex gap-1 pt-2 sm:gap-2">
      <HourAxis
        hours={hours}
        windowStart={window.start}
        height={height}
        pxPerMinute={PX_PER_MINUTE}
      />

      <div className="relative min-w-0 flex-1 rounded-lg border border-border" style={{ height }}>
        <HourLines hours={hours} windowStart={window.start} pxPerMinute={PX_PER_MINUTE} />
        {positioned.map((row) => (
          <AppointmentBlock
            key={row.entry.id}
            row={row}
            windowStart={window.start}
            pxPerMinute={PX_PER_MINUTE}
            timezone={timezone}
            onSelect={onSelect}
          />
        ))}
        {nowMin !== null && nowMin >= window.start && nowMin <= window.end ? (
          <NowLine top={(nowMin - window.start) * PX_PER_MINUTE} />
        ) : null}
      </div>
    </div>
  );
}

export function HourAxis({
  hours,
  windowStart,
  height,
  pxPerMinute,
}: {
  hours: readonly number[];
  windowStart: number;
  height: number;
  pxPerMinute: number;
}): ReactNode {
  return (
    <div className="relative w-10 shrink-0 sm:w-14" style={{ height }} aria-hidden="true">
      {hours.map((minute) => (
        <span
          key={minute}
          className="absolute right-1 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground sm:right-2 sm:text-xs"
          style={{ top: (minute - windowStart) * pxPerMinute }}
        >
          {String(Math.floor(minute / 60) % 24).padStart(2, '0')}:00
        </span>
      ))}
    </div>
  );
}

export function HourLines({
  hours,
  windowStart,
  pxPerMinute,
}: {
  hours: readonly number[];
  windowStart: number;
  pxPerMinute: number;
}): ReactNode {
  return hours.map((minute) => (
    <div
      key={minute}
      className="absolute inset-x-0 border-t border-border/60"
      style={{ top: (minute - windowStart) * pxPerMinute }}
      aria-hidden="true"
    />
  ));
}

export function NowLine({ top }: { top: number }): ReactNode {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-destructive"
      style={{ top }}
      role="presentation"
      title={t('calendar.now')}
    >
      <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-destructive" />
    </div>
  );
}
