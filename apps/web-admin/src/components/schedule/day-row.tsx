'use client';

import { useId, useState, type ReactNode } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { WEEKDAY_LABEL, type DayDraft } from '@/lib/schedule/entries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { WeekdayPicker } from './weekday-picker';

/**
 * Haftalık düzenleyicinin bir günü.
 *
 * Kapalı günde saat alanları GİZLENİYOR ama taslakta DURUYOR: kullanıcı
 * yanlışlıkla kapatıp geri açtığında girdiği saatler kaybolmuyor. Gönderimde
 * kapalı günün saatleri zaten yok sayılıyor (`toBranchHours`).
 *
 * Saat alanlarının etiketi telefonda görünür, geniş ekranda `sr-only`: yedi
 * satır boyunca aynı "Açılış / Kapanış" başlığı tekrar etmiyor, sütun düzeni
 * zaten anlamı taşıyor.
 */
export function DayRow({
  day,
  mode,
  disabled,
  canEdit,
  changed,
  error,
  warning,
  onChange,
  onCopy,
}: {
  day: DayDraft;
  /** Şube saatleri molayı taşıyor; personel planı taşımıyor. */
  mode: 'branch' | 'staff';
  disabled: boolean;
  canEdit: boolean;
  changed: boolean;
  error?: string | undefined;
  warning?: string | undefined;
  onChange: (patch: Partial<DayDraft>) => void;
  onCopy: (targets: number[]) => void;
}): ReactNode {
  const label = WEEKDAY_LABEL[day.dayOfWeek] ?? '';
  const hasBreak = day.breakStart !== '' || day.breakEnd !== '';
  const messageId = useId();
  const locked = disabled || !canEdit;

  return (
    <li
      className={cn(
        'relative rounded-xl border bg-card p-3 transition-colors sm:p-4',
        error !== undefined ? 'border-destructive' : 'border-border',
        day.closed && 'bg-muted/40',
      )}
    >
      {changed ? (
        <span
          aria-hidden="true"
          className="absolute top-3 bottom-3 left-0 w-1 rounded-r-full bg-primary"
        />
      ) : null}

      {/* Telefonda: [gün · anahtar][kopyala] / [saatler]. Geniş ekranda tek
          satır: [gün · anahtar][saatler][kopyala]. Sıra `order` ile; aynı
          düğmeyi iki kez render etmemek için. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 md:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 md:w-44 md:flex-none md:justify-start">
          <span className="text-body-emphasis">{label}</span>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={!day.closed}
              disabled={locked}
              aria-label={
                mode === 'branch'
                  ? t('schedule.dayOpen', { day: label })
                  : t('schedule.dayWorking', { day: label })
              }
              onCheckedChange={(open) => onChange({ closed: !open })}
            />
            <span className="w-16">
              {day.closed
                ? mode === 'branch'
                  ? t('schedule.closed')
                  : t('schedule.off')
                : mode === 'branch'
                  ? t('schedule.opened')
                  : t('schedule.working')}
            </span>
          </label>
        </div>

        {day.closed ? (
          <p className="hidden flex-1 text-sm text-muted-foreground md:order-2 md:block">—</p>
        ) : (
          <div className="order-3 flex basis-full flex-wrap items-end gap-x-4 gap-y-3 md:order-2 md:basis-auto md:flex-1">
            <TimeRange
              startLabel={mode === 'branch' ? t('schedule.open') : t('schedule.start')}
              endLabel={mode === 'branch' ? t('schedule.close') : t('schedule.end')}
              start={day.start}
              end={day.end}
              disabled={locked}
              describedBy={(error ?? warning) === undefined ? undefined : messageId}
              onStart={(start) => onChange({ start })}
              onEnd={(end) => onChange({ end })}
            />

            {mode === 'branch' ? (
              hasBreak ? (
                <div className="flex items-end gap-1">
                  <TimeRange
                    startLabel={t('schedule.breakStart')}
                    endLabel={t('schedule.breakEnd')}
                    prefix={t('schedule.break')}
                    start={day.breakStart}
                    end={day.breakEnd}
                    disabled={locked}
                    onStart={(breakStart) => onChange({ breakStart })}
                    onEnd={(breakEnd) => onChange({ breakEnd })}
                  />
                  {canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('schedule.removeBreak')}
                      disabled={disabled}
                      onClick={() => onChange({ breakStart: '', breakEnd: '' })}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              ) : canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange({ breakStart: '12:00', breakEnd: '13:00' })}
                >
                  <Plus aria-hidden="true" />
                  {t('schedule.addBreak')}
                </Button>
              ) : null
            ) : null}
          </div>
        )}

        {canEdit ? (
          <div className="order-2 shrink-0 md:order-3">
            <CopyDayButton
              dayOfWeek={day.dayOfWeek}
              label={label}
              disabled={disabled}
              onApply={onCopy}
            />
          </div>
        ) : null}
      </div>

      {error !== undefined || warning !== undefined ? (
        <p
          id={messageId}
          role={error !== undefined ? 'alert' : undefined}
          className={cn(
            'mt-2 text-sm',
            error !== undefined ? 'text-destructive' : 'text-warning',
          )}
        >
          {`${label}: ${error ?? warning ?? ''}`}
        </p>
      ) : null}
    </li>
  );
}

function TimeRange({
  startLabel,
  endLabel,
  prefix,
  start,
  end,
  disabled,
  describedBy,
  onStart,
  onEnd,
}: {
  startLabel: string;
  endLabel: string;
  prefix?: string;
  start: string;
  end: string;
  disabled: boolean;
  describedBy?: string | undefined;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
}): ReactNode {
  return (
    <div className="flex items-end gap-2">
      {prefix === undefined ? null : (
        <span className="pb-2.5 text-sm text-muted-foreground max-md:hidden">{prefix}</span>
      )}
      <TimeInput label={startLabel} value={start} disabled={disabled} describedBy={describedBy} onChange={onStart} />
      <span aria-hidden="true" className="pb-2.5 text-muted-foreground">
        –
      </span>
      <TimeInput label={endLabel} value={end} disabled={disabled} describedBy={describedBy} onChange={onEnd} />
    </div>
  );
}

function TimeInput({
  label,
  value,
  disabled,
  describedBy,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  describedBy?: string | undefined;
  onChange: (value: string) => void;
}): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground md:sr-only">
        {label}
      </label>
      <Input
        id={id}
        type="time"
        step={300}
        value={value}
        disabled={disabled}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        className="h-10 w-[6.75rem] tabular-nums"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function CopyDayButton({
  dayOfWeek,
  label,
  disabled,
  onApply,
}: {
  dayOfWeek: number;
  label: string;
  disabled: boolean;
  onApply: (targets: number[]) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<number[]>([]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTargets([]);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t('schedule.copyDay', { day: label })}
          title={t('schedule.copyDay', { day: label })}
        >
          <Copy aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <p className="text-body-emphasis">{t('schedule.copyDay', { day: label })}</p>
        <WeekdayPicker
          label={t('schedule.copyTo')}
          value={targets}
          exclude={dayOfWeek}
          onChange={setTargets}
        />
        <Button
          type="button"
          size="sm"
          className="self-end"
          disabled={targets.length === 0}
          onClick={() => {
            onApply(targets);
            setOpen(false);
            setTargets([]);
          }}
        >
          {t('schedule.copyApply')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
