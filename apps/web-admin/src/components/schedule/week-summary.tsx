'use client';

import { Fragment, type ReactNode } from 'react';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import {
  formatHours,
  parseTime,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  workingMinutes,
  type DayDraft,
} from '@/lib/schedule/entries';

/**
 * Haftanın tek bakışta görünümü: her gün bir yatay çubuk, mola bir boşluk.
 *
 * `reference` verilirse (personel planında şube saatleri) çubuğun ARKASINA
 * kesik çizgili bir bant çiziliyor: personelin şube saatleri dışına taştığı
 * yer, bandın dışında kalan çubuk parçası olarak GÖRÜNÜYOR.
 *
 * Görsel bir özet; aynı bilgi aşağıdaki gün satırlarında metin olarak var.
 * Bu yüzden çubuklar `aria-hidden`, ekran okuyucuya yalnız günlük ve haftalık
 * toplamlar okunuyor.
 */

const DEFAULT_FROM = 8 * 60;
const DEFAULT_TO = 20 * 60;
const MIN_SPAN = 8 * 60;

export function WeekSummary({
  days,
  reference,
  closedLabel,
}: {
  days: readonly DayDraft[];
  reference?: readonly DayDraft[] | undefined;
  closedLabel: string;
}): ReactNode {
  const [from, to] = axisRange([...days, ...(reference ?? [])]);
  const span = to - from;
  const pct = (minutes: number): number => ((minutes - from) / span) * 100;
  const ticks = tickHours(from, to);
  const total = days.reduce((sum, day) => sum + workingMinutes(day), 0);

  return (
    <section
      aria-label={t('schedule.summary')}
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-label text-muted-foreground">{t('schedule.summary')}</h3>
        <p className="text-sm">
          <span className="text-muted-foreground">{t('schedule.weekTotal')}: </span>
          <span className="text-body-emphasis tabular-nums">{formatHours(total)}</span>
        </p>
      </div>

      <div className="grid grid-cols-[2.5rem_1fr_3.5rem] items-center gap-x-3 gap-y-1.5">
        {/* Saat ekseni */}
        <span aria-hidden="true" />
        <div aria-hidden="true" className="relative h-4 text-[0.6875rem] text-muted-foreground tabular-nums">
          {ticks.map((minutes, index) => (
            <span
              key={minutes}
              className={cn(
                'absolute -translate-x-1/2',
                // Dar ekranda her ikinci etiket gizleniyor; çizgiler kalıyor.
                index % 2 === 1 && 'max-sm:hidden',
              )}
              style={{ left: `${pct(minutes)}%` }}
            >
              {String(minutes / 60).padStart(2, '0')}
            </span>
          ))}
        </div>
        <span aria-hidden="true" />

        {WEEKDAY_ORDER.map((dayOfWeek) => {
          const day = days.find((entry) => entry.dayOfWeek === dayOfWeek);
          if (day === undefined) return null;
          const ref = reference?.find((entry) => entry.dayOfWeek === dayOfWeek);
          const minutes = workingMinutes(day);

          return (
            <Fragment key={dayOfWeek}>
              <span className="text-sm font-semibold">{WEEKDAY_SHORT[dayOfWeek]}</span>
              <div aria-hidden="true" className="relative h-6 rounded-md bg-muted/60">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    className="absolute inset-y-0 w-px bg-border"
                    style={{ left: `${pct(tick)}%` }}
                  />
                ))}
                {ref !== undefined ? <ReferenceBand day={ref} pct={pct} /> : null}
                {day.closed ? (
                  <span className="absolute inset-0 flex items-center pl-2 text-xs text-muted-foreground">
                    {closedLabel}
                  </span>
                ) : (
                  segmentsOf(day).map(([start, end]) => (
                    <span
                      key={start}
                      className="absolute inset-y-1 rounded bg-primary/85"
                      style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
                    />
                  ))
                )}
              </div>
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {minutes === 0 ? '—' : formatHours(minutes)}
              </span>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

function ReferenceBand({
  day,
  pct,
}: {
  day: DayDraft;
  pct: (minutes: number) => number;
}): ReactNode {
  if (day.closed) return null;
  const open = parseTime(day.start);
  const close = parseTime(day.end);
  if (open === null || close === null || close <= open) return null;
  return (
    <span
      className="absolute inset-y-0 rounded-md border border-dashed border-primary/50 bg-primary/10"
      style={{ left: `${pct(open)}%`, width: `${pct(close) - pct(open)}%` }}
    />
  );
}

/** Çalışma aralığını mola boşluğuyla bölünmüş parçalar olarak döner. */
function segmentsOf(day: DayDraft): [number, number][] {
  const open = parseTime(day.start);
  const close = parseTime(day.end);
  if (open === null || close === null || close <= open) return [];
  const breakStart = parseTime(day.breakStart);
  const breakEnd = parseTime(day.breakEnd);
  if (breakStart === null || breakEnd === null || breakEnd <= breakStart) return [[open, close]];
  const segments: [number, number][] = [];
  if (breakStart > open) segments.push([open, Math.min(breakStart, close)]);
  if (breakEnd < close) segments.push([Math.max(breakEnd, open), close]);
  return segments;
}

/** Açık günlerin kapsadığı aralık, saate yuvarlanmış; en az `MIN_SPAN`. */
function axisRange(days: readonly DayDraft[]): [number, number] {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const day of days) {
    if (day.closed) continue;
    const open = parseTime(day.start);
    const close = parseTime(day.end);
    if (open === null || close === null || close <= open) continue;
    from = Math.min(from, open);
    to = Math.max(to, close);
  }
  if (!Number.isFinite(from)) return [DEFAULT_FROM, DEFAULT_TO];

  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;
  if (to - from < MIN_SPAN) {
    const pad = Math.ceil((MIN_SPAN - (to - from)) / 2 / 60) * 60;
    from = Math.max(0, from - pad);
    to = Math.min(24 * 60, to + pad);
  }
  return [from, to];
}

/** 2 ya da 3 saatlik adımlarla eksen işaretleri. */
function tickHours(from: number, to: number): number[] {
  const step = to - from > 12 * 60 ? 180 : 120;
  const first = Math.ceil(from / step) * step;
  const ticks: number[] = [];
  for (let minutes = first; minutes <= to; minutes += step) ticks.push(minutes);
  return ticks;
}
