'use client';

import { useMemo, type ReactNode } from 'react';
import { isAppointmentStatus, type CalendarEntry } from '@klinara/shared';
import { cn } from '@/lib/cn';
import { t } from '@/i18n/tr';
import { formatDayLabel, formatTime, todayKey, type DayKey } from '@/lib/calendar/date';
import { groupByDay } from '@/lib/calendar/grid';
import { STATUS_LABEL, occupiesSlot } from '@/lib/calendar/status';
import { toneClassOf } from './appointment-block';

/**
 * Ajanda — gün ya da haftanın randevuları, gün başlıkları altında liste.
 *
 * Izgaranın telefondaki karşılığı: dar ekranda zaman ekseni yerini boşa
 * harcıyor, oysa resepsiyonun o an sorduğu "sıradaki kim, hangi hizmet, hangi
 * personel". Liste bunu tek bakışta veriyor ve metin hiç kırpılmıyor.
 *
 * Satır tek bir `button` (ızgaradaki blokla aynı `onSelect`); içindeki metin
 * ekran okuyucuya zaten sırayla okunuyor, ayrı `aria-label` gerekmiyor.
 */

export interface AgendaListProps {
  days: readonly DayKey[];
  entries: readonly CalendarEntry[];
  timezone: string;
  /** `staffProfileId → ad`; bulunamayan kimlik satırda gösterilmiyor. */
  staffNames?: ReadonlyMap<string, string>;
  onSelect: (entry: CalendarEntry) => void;
  /** Gün başlıklarını gizle — tek günlük gömülü kullanım (dashboard) için. */
  hideDayHeaders?: boolean;
  emptyMessage?: string;
}

export function AgendaList({
  days,
  entries,
  timezone,
  staffNames,
  onSelect,
  hideDayHeaders = false,
  emptyMessage,
}: AgendaListProps): ReactNode {
  const groups = useMemo(() => groupByDay(entries, timezone, days), [entries, timezone, days]);
  const today = todayKey(timezone);
  const total = [...groups.values()].reduce((sum, list) => sum + list.length, 0);

  if (total === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage ?? t('calendar.empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const list = groups.get(day) ?? [];
        // Çok günlü listede boş gün TEK SATIRA iniyor: yedi başlığın altında
        // beş kez "randevu yok" yazmak, dolu günleri aşağı itmekten ibaret.
        const collapsed = list.length === 0;
        return (
          <section key={day} aria-label={hideDayHeaders ? undefined : formatDayLabel(day)}>
            {hideDayHeaders ? null : (
              <h3
                className={cn(
                  'sticky top-16 z-10 flex items-baseline justify-between gap-2 border-b border-border bg-card py-2 text-sm font-semibold',
                  day === today && 'text-primary',
                  collapsed && 'border-transparent font-normal text-muted-foreground',
                )}
              >
                <span>
                  {formatDayLabel(day)}
                  {day === today ? ` · ${t('calendar.today')}` : ''}
                </span>
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {collapsed
                    ? t('calendar.dayEmpty')
                    : t('calendar.appointmentCount', { count: list.length })}
                </span>
              </h3>
            )}
            {collapsed ? null : (
              <ul className="flex flex-col divide-y divide-border">
                {list.map((entry) => (
                  <li key={entry.id}>
                    <AgendaRow
                      entry={entry}
                      timezone={timezone}
                      staffNames={staffNames}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AgendaRow({
  entry,
  timezone,
  staffNames,
  onSelect,
}: {
  entry: CalendarEntry;
  timezone: string;
  staffNames: ReadonlyMap<string, string> | undefined;
  onSelect: (entry: CalendarEntry) => void;
}): ReactNode {
  const status = isAppointmentStatus(entry.status) ? entry.status : 'scheduled';
  const dimmed = !occupiesSlot(status);
  const services = entry.services.map((line) => line.serviceName).join(', ');
  const staff = [
    ...new Set(
      entry.services
        .map((line) => staffNames?.get(line.staffProfileId))
        .filter((name): name is string => name !== undefined),
    ),
  ].join(', ');

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg px-2 py-3 text-left transition-colors hover:bg-accent/50 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:items-center"
    >
      <span className="flex flex-col text-sm tabular-nums sm:flex-row sm:gap-1">
        <span className="font-semibold">{formatTime(entry.startsAt, timezone)}</span>
        <span className="text-xs text-muted-foreground sm:text-sm">
          <span className="hidden sm:inline">– </span>
          {formatTime(entry.endsAt, timezone)}
        </span>
      </span>

      <span className={cn('flex min-w-0 flex-col', dimmed && 'opacity-60')}>
        <span className={cn('truncate font-medium', dimmed && 'line-through')}>
          {entry.customerName}
        </span>
        {services === '' ? null : (
          <span className="truncate text-sm text-muted-foreground">{services}</span>
        )}
        {staff === '' ? null : (
          <span className="truncate text-xs text-muted-foreground">{staff}</span>
        )}
      </span>

      <span
        className={cn(
          'col-start-2 w-fit rounded-full border px-2 py-0.5 text-xs font-medium sm:col-start-auto',
          toneClassOf(status),
        )}
      >
        {t(STATUS_LABEL[status])}
      </span>
    </button>
  );
}
