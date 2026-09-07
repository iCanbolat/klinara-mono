'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';
import { Alert } from '@/components/ui/alert';
import { Field, FieldCheckbox } from '@/components/ui/field';
import {
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
  validateWeek,
  type DayDraft,
} from '@/lib/schedule/entries';

/**
 * Haftalık plan düzenleyicisi.
 *
 * ---------------------------------------------------------------------------
 * YEDİ GÜN HER ZAMAN EKRANDA
 * ---------------------------------------------------------------------------
 * `PUT` TAM DEĞİŞTİRME olduğu için ekranda görünmeyen bir gün, kaydedilince
 * silinen bir gün demek. Kapalı günler "kapalı" onay kutusuyla duruyor,
 * listeden düşürülmüyor — kullanıcı ne göndereceğini GÖRÜYOR.
 *
 * Sıra PAZARTESİ'den başlıyor (`WEEKDAY_ORDER`); veri sırası pazardan
 * başlıyor (PostgreSQL `dow`) ve ikisini karıştırmak haftayı bir gün kaydırır.
 */
export function WeekGridEditor({
  days,
  withBreak,
  disabled,
  onChange,
}: {
  days: readonly DayDraft[];
  /** Şube saatleri molayı taşıyor; personel planı taşımıyor. */
  withBreak: boolean;
  disabled: boolean;
  onChange: (days: DayDraft[]) => void;
}): ReactNode {
  const issues = validateWeek(days);

  function update(dayOfWeek: number, patch: Partial<DayDraft>): void {
    onChange(days.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('schedule.replaceWarning')}</p>

      {issues.map((issue) => (
        <Alert key={`${String(issue.dayOfWeek)}-${issue.message}`} tone="danger">
          <span role="alert">
            {WEEKDAY_LABEL[issue.dayOfWeek]}: {issue.message}
          </span>
        </Alert>
      ))}

      <div className="flex flex-col gap-2">
        {WEEKDAY_ORDER.map((dayOfWeek) => {
          const day = days.find((entry) => entry.dayOfWeek === dayOfWeek);
          if (day === undefined) return null;

          return (
            <div
              key={dayOfWeek}
              className="grid items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-[10rem_1fr_1fr_1fr_1fr]"
            >
              <FieldCheckbox
                label={`${WEEKDAY_LABEL[dayOfWeek] ?? ''} — ${withBreak ? t('schedule.closed') : t('schedule.off')}`}
                checked={day.closed}
                disabled={disabled}
                onCheckedChange={(closed) => update(dayOfWeek, { closed })}
              />
              <Field
                label={t('schedule.open')}
                type="time"
                value={day.start}
                disabled={disabled || day.closed}
                onChange={(event) => update(dayOfWeek, { start: event.target.value })}
              />
              <Field
                label={t('schedule.close')}
                type="time"
                value={day.end}
                disabled={disabled || day.closed}
                onChange={(event) => update(dayOfWeek, { end: event.target.value })}
              />
              {withBreak ? (
                <>
                  <Field
                    label={t('schedule.breakStart')}
                    type="time"
                    value={day.breakStart}
                    disabled={disabled || day.closed}
                    onChange={(event) => update(dayOfWeek, { breakStart: event.target.value })}
                  />
                  <Field
                    label={t('schedule.breakEnd')}
                    type="time"
                    value={day.breakEnd}
                    disabled={disabled || day.closed}
                    onChange={(event) => update(dayOfWeek, { breakEnd: event.target.value })}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
