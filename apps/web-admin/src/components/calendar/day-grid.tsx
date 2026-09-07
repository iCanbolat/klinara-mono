'use client';

import { useMemo, type ReactNode } from 'react';
import type { CalendarEntry } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { formatTime, minutesOfDay } from '@/lib/calendar/date';
import { layoutLanes } from '@/lib/calendar/layout';
import { STATUS_TONE, occupiesSlot } from '@/lib/calendar/status';
import { isAppointmentStatus } from '@klinara/shared';

/**
 * Gün ızgarası — dakika başına piksel, `position: absolute` bloklar.
 *
 * Kütüphane kullanılmadı; gerekçe `lib/calendar/layout.ts` başlığında. Izgara
 * sabit ve tek zor parça olan şerit yerleşimi orada, saf ve test edilmiş
 * hâlde duruyor. Bu dosya yalnız çiziyor.
 *
 * ---------------------------------------------------------------------------
 * PENCERE
 * ---------------------------------------------------------------------------
 * Gösterilen saat aralığı VERİDEN türetiliyor, sabit 09–19 değil: bir klinik
 * 07:00'de açılıp 22:00'de kapanabilir ve sabit pencere o randevuları
 * ızgaranın dışına atardı. Taban 08–20; randevular dışına taşıyorsa pencere
 * genişliyor.
 */

const PX_PER_MINUTE = 1.1;
const DEFAULT_START = 8 * 60;
const DEFAULT_END = 20 * 60;

export interface DayGridProps {
  entries: readonly CalendarEntry[];
  timezone: string;
  onSelect: (entry: CalendarEntry) => void;
}

interface Positioned {
  entry: CalendarEntry;
  startMin: number;
  endMin: number;
  lane: number;
  laneCount: number;
}

export function DayGrid({ entries, timezone, onSelect }: DayGridProps): ReactNode {
  const { positioned, windowStart, windowEnd } = useMemo(() => {
    const spans = entries.map((entry) => ({
      entry,
      startMin: minutesOfDay(entry.startsAt, timezone),
      endMin: minutesOfDay(entry.endsAt, timezone),
    }));

    // Gece yarısını aşan randevu: bitiş dakikası başlangıçtan küçük çıkar.
    // Izgara tek gün çizdiği için bitiş gün sonuna sabitleniyor.
    for (const span of spans) {
      if (span.endMin <= span.startMin) span.endMin = 24 * 60;
    }

    const lanes = layoutLanes(
      spans.map((span) => ({ id: span.entry.id, startMin: span.startMin, endMin: span.endMin })),
    );
    const laneById = new Map(lanes.map((lane) => [lane.id, lane]));

    const rows: Positioned[] = spans.map((span) => {
      const lane = laneById.get(span.entry.id);
      return {
        ...span,
        lane: lane?.lane ?? 0,
        laneCount: lane?.laneCount ?? 1,
      };
    });

    const earliest = rows.reduce((min, row) => Math.min(min, row.startMin), DEFAULT_START);
    const latest = rows.reduce((max, row) => Math.max(max, row.endMin), DEFAULT_END);

    return {
      positioned: rows,
      // Saat başına yuvarlanıyor ki saat çizgileri tam saatte otursun.
      windowStart: Math.floor(earliest / 60) * 60,
      windowEnd: Math.ceil(latest / 60) * 60,
    };
  }, [entries, timezone]);

  const height = (windowEnd - windowStart) * PX_PER_MINUTE;
  const hours = Array.from(
    { length: Math.ceil((windowEnd - windowStart) / 60) + 1 },
    (_, index) => windowStart + index * 60,
  );

  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('calendar.empty')}</p>;
  }

  return (
    <div className="flex gap-2 overflow-x-auto">
      {/* Saat sütunu */}
      <div className="relative w-14 shrink-0" style={{ height }}>
        {hours.map((minute) => (
          <span
            key={minute}
            className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground"
            style={{ top: (minute - windowStart) * PX_PER_MINUTE }}
          >
            {String(Math.floor(minute / 60) % 24).padStart(2, '0')}:00
          </span>
        ))}
      </div>

      {/* Izgara */}
      <div className="relative min-w-[18rem] flex-1 rounded-lg border border-border" style={{ height }}>
        {hours.map((minute) => (
          <div
            key={minute}
            className="absolute inset-x-0 border-t border-border/60"
            style={{ top: (minute - windowStart) * PX_PER_MINUTE }}
            aria-hidden="true"
          />
        ))}

        {positioned.map((row) => (
          <AppointmentBlock
            key={row.entry.id}
            row={row}
            windowStart={windowStart}
            timezone={timezone}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  info: 'bg-secondary text-secondary-foreground border-border',
  ok: 'bg-success-soft text-foreground border-success',
  warn: 'bg-warning-soft text-foreground border-warning',
  danger: 'bg-destructive/10 text-foreground border-destructive',
};

function AppointmentBlock({
  row,
  windowStart,
  timezone,
  onSelect,
}: {
  row: Positioned;
  windowStart: number;
  timezone: string;
  onSelect: (entry: CalendarEntry) => void;
}): ReactNode {
  const status = isAppointmentStatus(row.entry.status) ? row.entry.status : 'scheduled';
  const tone = STATUS_TONE[status];
  const dimmed = !occupiesSlot(status);

  const width = `calc(${String(100 / row.laneCount)}% - 4px)`;
  const left = `calc(${String((100 / row.laneCount) * row.lane)}% + 2px)`;

  return (
    <button
      type="button"
      onClick={() => onSelect(row.entry)}
      className={cn(
        'absolute overflow-hidden rounded-lg border px-2 py-1 text-left text-xs transition-colors',
        TONE_CLASS[tone] ?? TONE_CLASS['info'],
        // İptal ve gelmedi SLOT KAPLAMAZ (sunucuda `active=false`); soluk ve
        // üstü çizili çiziliyor ki dolu bir saat gibi okunmasınlar.
        dimmed && 'opacity-60 line-through',
      )}
      style={{
        top: (row.startMin - windowStart) * PX_PER_MINUTE,
        height: Math.max((row.endMin - row.startMin) * PX_PER_MINUTE, 22),
        width,
        left,
      }}
    >
      <span className="block truncate font-medium">{row.entry.customerName}</span>
      <span className="block truncate text-[11px] opacity-80">
        {formatTime(row.entry.startsAt, timezone)}
        {row.entry.services.length > 0 ? ` · ${row.entry.services[0]?.serviceName ?? ''}` : ''}
      </span>
    </button>
  );
}
