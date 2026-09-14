'use client';

import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import {
  copyDay,
  WEEKDAY_LABEL,
  WEEKDAY_ORDER,
  type DayDraft,
  type DayIssue,
} from '@/lib/schedule/entries';
import { Button } from '@/components/ui/button';
import { DayRow } from './day-row';
import type { WeekDraft } from './use-week-draft';
import { WeekSummary } from './week-summary';

/**
 * Haftalık plan düzenleyicisi: özet çizelgesi + yedi gün + kaydet çubuğu.
 *
 * ---------------------------------------------------------------------------
 * YEDİ GÜN HER ZAMAN EKRANDA
 * ---------------------------------------------------------------------------
 * `PUT` TAM DEĞİŞTİRME olduğu için ekranda görünmeyen bir gün, kaydedilince
 * silinen bir gün demek. Kapalı günler listeden düşürülmüyor — kullanıcı ne
 * göndereceğini GÖRÜYOR.
 *
 * Sıra PAZARTESİ'den başlıyor (`WEEKDAY_ORDER`); veri sırası pazardan
 * başlıyor (PostgreSQL `dow`) ve ikisini karıştırmak haftayı bir gün kaydırır.
 *
 * ---------------------------------------------------------------------------
 * KAYDET ÇUBUĞU YAPIŞKAN
 * ---------------------------------------------------------------------------
 * Yedi satır telefonda birkaç ekran boyu; kaydet düğmesi listenin sonunda
 * kalsaydı pazartesiyi değiştiren kullanıcı onu aramak zorunda kalırdı.
 * Çubuk ekranın altına yapışıyor ve kaç günün değiştiğini söylüyor.
 */
export function WeekEditor({
  mode,
  week,
  canWrite,
  saving,
  reference,
  warnings = [],
  toolbar,
  onSave,
}: {
  mode: 'branch' | 'staff';
  week: WeekDraft;
  canWrite: boolean;
  saving: boolean;
  /** Personel planında şube saatleri — özet çizelgesinde arka bant. */
  reference?: readonly DayDraft[] | undefined;
  /** Engellemeyen uyarılar (ör. şube saatleri dışı). */
  warnings?: readonly DayIssue[];
  /** Düzenleyicinin üstünde, özetin yanında duran eylemler. */
  toolbar?: ReactNode;
  onSave: () => void;
}): ReactNode {
  const { draft, changed, dirty, issues } = week;
  const disabled = saving;

  function update(dayOfWeek: number, patch: Partial<DayDraft>): void {
    week.setDraft(draft.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)));
  }

  function copy(source: number, targets: number[]): void {
    week.setDraft(copyDay(draft, source, targets));
    toast.success(
      t('schedule.copied', { day: WEEKDAY_LABEL[source] ?? '', count: targets.length }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <WeekSummary
        days={draft}
        reference={reference}
        closedLabel={mode === 'branch' ? t('schedule.closed') : t('schedule.off')}
      />

      {toolbar === undefined ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">{toolbar}</div>
      )}

      <ul className="flex flex-col gap-2">
        {WEEKDAY_ORDER.map((dayOfWeek) => {
          const day = draft.find((entry) => entry.dayOfWeek === dayOfWeek);
          if (day === undefined) return null;
          return (
            <DayRow
              key={dayOfWeek}
              day={day}
              mode={mode}
              disabled={disabled}
              canEdit={canWrite}
              changed={changed.includes(dayOfWeek)}
              error={issues.find((issue) => issue.dayOfWeek === dayOfWeek)?.message}
              warning={warnings.find((issue) => issue.dayOfWeek === dayOfWeek)?.message}
              onChange={(patch) => update(dayOfWeek, patch)}
              onCopy={(targets) => copy(dayOfWeek, targets)}
            />
          );
        })}
      </ul>

      {canWrite ? (
        <div
          className={cn(
            'sticky bottom-0 z-10 -mx-2 flex flex-col gap-3 rounded-t-xl border-t bg-background/95 px-2 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between',
            dirty ? 'border-primary/40' : 'border-border',
          )}
        >
          <div className="flex flex-col gap-0.5">
            <p aria-live="polite" className={cn('text-sm', dirty ? 'text-body-emphasis' : 'text-muted-foreground')}>
              {issues.length > 0
                ? t('schedule.fixDays', { count: issues.length })
                : dirty
                  ? t('schedule.unsaved', { count: changed.length })
                  : t('schedule.allSaved')}
            </p>
            <p className="text-xs text-muted-foreground">{t('schedule.replaceWarning')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {dirty ? (
              <Button type="button" variant="ghost" disabled={saving} onClick={week.reset}>
                {t('schedule.discard')}
              </Button>
            ) : null}
            <Button
              type="button"
              loading={saving}
              disabled={saving || !dirty || issues.length > 0}
              onClick={onSave}
              className="max-sm:flex-1"
            >
              {t('schedule.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
