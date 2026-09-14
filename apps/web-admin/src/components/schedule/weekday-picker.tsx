'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { WEEKDAY_GROUPS, WEEKDAY_LABEL, WEEKDAY_ORDER, WEEKDAY_SHORT } from '@/lib/schedule/entries';

/**
 * Gün çipleri + hızlı seçimler (hafta içi / hafta sonu / tümü).
 *
 * Çipler `aria-pressed` düğmeler; erişilebilir adları günün TAM adı
 * ("Pazartesi"), görünen metin kısaltma. `exclude` edilen gün (kopyalamada
 * kaynak gün) listede görünüyor ama seçilemiyor — kaybolması hangi günden
 * kopyalandığını belirsizleştirirdi.
 */
export function WeekdayPicker({
  value,
  onChange,
  exclude,
  disabled = false,
  label,
}: {
  value: readonly number[];
  onChange: (days: number[]) => void;
  exclude?: number;
  disabled?: boolean;
  label: string;
}): ReactNode {
  const selectable = (day: number): boolean => day !== exclude;

  function toggle(day: number): void {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  }

  function pickGroup(days: readonly number[]): void {
    const next = days.filter(selectable);
    const allOn = next.every((day) => value.includes(day)) && next.length === value.length;
    onChange(allOn ? [] : next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {WEEKDAY_ORDER.map((day) => {
          const pressed = value.includes(day);
          const locked = !selectable(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={pressed}
              aria-label={WEEKDAY_LABEL[day]}
              disabled={disabled || locked}
              onClick={() => toggle(day)}
              className={cn(
                'h-9 min-w-11 rounded-lg border px-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
                pressed
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:bg-muted',
                locked && 'border-dashed opacity-50',
              )}
            >
              {WEEKDAY_SHORT[day]}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <GroupLink disabled={disabled} onClick={() => pickGroup(WEEKDAY_GROUPS.weekdays)}>
          {t('schedule.groupWeekdays')}
        </GroupLink>
        <GroupLink disabled={disabled} onClick={() => pickGroup(WEEKDAY_GROUPS.weekend)}>
          {t('schedule.groupWeekend')}
        </GroupLink>
        <GroupLink disabled={disabled} onClick={() => pickGroup(WEEKDAY_GROUPS.all)}>
          {t('schedule.groupAll')}
        </GroupLink>
      </div>
    </div>
  );
}

function GroupLink({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="font-semibold text-secondary-foreground underline-offset-4 hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}
