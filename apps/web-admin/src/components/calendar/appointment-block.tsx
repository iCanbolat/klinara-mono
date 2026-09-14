'use client';

import type { ReactNode } from 'react';
import { isAppointmentStatus, type CalendarEntry } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/calendar/date';
import type { PositionedEntry } from '@/lib/calendar/grid';
import { STATUS_TONE, occupiesSlot } from '@/lib/calendar/status';

/**
 * Izgaradaki tek randevu bloğu — gün ızgarası ve hafta ızgarasının her sütunu
 * bunu paylaşıyor.
 *
 * `compact` hafta sütunu için: sütun telefonda ~45px, masaüstünde ~120px.
 * Orada hizmet adı hiçbir zaman sığmıyor; saat ve müşteri adı yetiyor,
 * ayrıntı bloğa tıklayınca açılan panelde.
 */

export const TONE_CLASS: Record<string, string> = {
  info: 'bg-secondary text-secondary-foreground border-border',
  ok: 'bg-success-soft text-foreground border-success',
  warn: 'bg-warning-soft text-foreground border-warning',
  danger: 'bg-destructive/10 text-foreground border-destructive',
};

export function toneClassOf(status: string): string {
  const safe = isAppointmentStatus(status) ? status : 'scheduled';
  return TONE_CLASS[STATUS_TONE[safe]] ?? TONE_CLASS['info'] ?? '';
}

/** Blok yüksekliği tabanı — daha kısa bir blok tıklanamayacak kadar ince olur. */
const MIN_HEIGHT = 22;

export function AppointmentBlock({
  row,
  windowStart,
  pxPerMinute,
  timezone,
  compact = false,
  onSelect,
}: {
  row: PositionedEntry;
  windowStart: number;
  pxPerMinute: number;
  timezone: string;
  compact?: boolean;
  onSelect: (entry: CalendarEntry) => void;
}): ReactNode {
  const status = isAppointmentStatus(row.entry.status) ? row.entry.status : 'scheduled';
  const dimmed = !occupiesSlot(status);
  const height = Math.max((row.endMin - row.startMin) * pxPerMinute, MIN_HEIGHT);
  const gap = compact ? 2 : 4;
  const time = formatTime(row.entry.startsAt, timezone);
  const service = row.entry.services[0]?.serviceName;

  return (
    <button
      type="button"
      onClick={() => onSelect(row.entry)}
      // Dar blokta metin kırpılıyor; tam bilgi erişilebilir adda ve `title`da.
      aria-label={`${time} ${row.entry.customerName}${service === undefined ? '' : ` · ${service}`}`}
      title={`${time} · ${row.entry.customerName}${service === undefined ? '' : ` · ${service}`}`}
      className={cn(
        'absolute overflow-hidden border text-left transition-colors hover:brightness-95',
        compact
          ? 'rounded-md px-1 py-0.5 text-[10px] leading-tight'
          : 'rounded-lg px-2 py-1 text-xs',
        toneClassOf(status),
        // İptal ve gelmedi SLOT KAPLAMAZ (sunucuda `active=false`); soluk ve
        // üstü çizili çiziliyor ki dolu bir saat gibi okunmasınlar.
        dimmed && 'opacity-60 line-through',
      )}
      style={{
        top: (row.startMin - windowStart) * pxPerMinute,
        height,
        width: `calc(${String(100 / row.laneCount)}% - ${String(gap)}px)`,
        left: `calc(${String((100 / row.laneCount) * row.lane)}% + ${String(gap / 2)}px)`,
      }}
    >
      {compact ? (
        <>
          <span className="block truncate tabular-nums opacity-80">{time}</span>
          {height >= 36 ? (
            <span className="block truncate font-medium">{row.entry.customerName}</span>
          ) : null}
        </>
      ) : (
        <>
          <span className="block truncate font-medium">{row.entry.customerName}</span>
          <span className="block truncate text-[11px] opacity-80">
            {time}
            {service === undefined ? '' : ` · ${service}`}
          </span>
        </>
      )}
    </button>
  );
}
