'use client';

import { CalendarClock, ChevronDown, Clock, MapPin, Sparkles, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import type { SelectionSummary } from './selection';
import type { Step } from './machine';
import { formatDateTime, formatMinor } from './slot-grouping';
import { t } from '@/i18n/tr';

/**
 * Seçimlerin canlı özeti.
 *
 * Masaüstünde sağ kolonda sabit duruyor, mobilde katlanabilir bir şeride
 * dönüşüyor. Amacı süs değil: yedi adımlık bir akışta kullanıcı "ben neyi
 * seçmiştim" sorusunu geri gidip adım adım aramak zorunda kalmamalı.
 */

interface Props {
  selection: SelectionSummary;
  /** Yalnız akışta GERÇEKTEN bulunan adımlara "Değiştir" çıkıyor. */
  steps: Step[];
  onEdit: (step: Step) => void;
}

function Row({
  icon,
  label,
  value,
  step,
  steps,
  onEdit,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  step: Step;
  steps: Step[];
  onEdit: (step: Step) => void;
}) {
  const filled = value !== null && value !== undefined && value !== '';
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0 opacity-45">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] tracking-wide uppercase opacity-50">{label}</p>
        <p className={cn('text-sm', filled ? 'font-medium' : 'opacity-40')}>
          {filled ? value : t('booking.summary.empty')}
        </p>
      </div>
      {filled && steps.includes(step) && (
        <button
          type="button"
          onClick={() => {
            onEdit(step);
          }}
          className="shrink-0 text-xs underline underline-offset-2 opacity-55 transition-opacity hover:opacity-100"
        >
          {t('common.change')}
        </button>
      )}
    </div>
  );
}

export function SummaryRows({ selection, steps, onEdit }: Props) {
  return (
    <div className="divide-y divide-(--border-subtle)">
      <Row
        icon={<MapPin className="size-4" />}
        label={t('booking.step.branch')}
        value={selection.branchName}
        step="branch"
        steps={steps}
        onEdit={onEdit}
      />
      <Row
        icon={<Sparkles className="size-4" />}
        label={t('booking.step.service')}
        value={selection.services.map((service) => service.name).join(', ')}
        step="service"
        steps={steps}
        onEdit={onEdit}
      />
      {steps.includes('staff') && (
        <Row
          icon={<User className="size-4" />}
          label={t('booking.step.staff')}
          value={
            selection.staffDecided ? (selection.staffName ?? t('booking.staff.any')) : null
          }
          step="staff"
          steps={steps}
          onEdit={onEdit}
        />
      )}
      <Row
        icon={<CalendarClock className="size-4" />}
        label={t('booking.step.datetime')}
        value={
          selection.startsAt === null
            ? null
            : formatDateTime(selection.startsAt, selection.timezone)
        }
        step="datetime"
        steps={steps}
        onEdit={onEdit}
      />

      {selection.services.length > 0 && (
        <div className="flex items-center justify-between gap-3 pt-3 text-sm">
          <span className="flex items-center gap-2 opacity-60">
            <Clock className="size-4" />
            {selection.totalMinutes} {t('common.minutes')}
          </span>
          {/* Fiyat düğümü `showPrices` kapalıyken hiç üretilmiyor. */}
          {selection.totalMinor !== null && (
            <span className="font-semibold">
              {formatMinor(selection.totalMinor, selection.currency)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Masaüstü: sağ kolonda sabit. */
export function SummaryPanel(props: Props) {
  return (
    <aside className="hidden lg:block">
      <Card className="sticky top-24 px-5 py-4">
        <h2 className="pb-1 text-sm font-semibold">{t('booking.summary.title')}</h2>
        <SummaryRows {...props} />
      </Card>
    </aside>
  );
}

/** Mobil: stepper'ın altında katlanabilir şerit. */
export function SummaryBar(props: Props) {
  const [open, setOpen] = useState(false);
  const { selection } = props;
  const headline =
    selection.services.length === 0
      ? (selection.branchName ?? t('booking.summary.empty'))
      : selection.services.map((service) => service.name).join(', ');

  return (
    <Card className="overflow-hidden lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] tracking-wide uppercase opacity-50">
            {t('booking.summary.title')}
          </span>
          <span className="block truncate text-sm font-medium">{headline}</span>
        </span>
        <span className="sr-only">
          {open ? t('booking.summary.hide') : t('booking.summary.show')}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 opacity-60 transition-transform duration-(--dur-base)',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* `grid-rows` geçişi: `height: auto` animasyonlanamıyor ve sabit bir
          yükseklik vermek uzun hizmet adlarında içeriği kırpardı. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-(--dur-base) ease-(--ease-out)',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3">
            <SummaryRows {...props} />
          </div>
        </div>
      </div>
    </Card>
  );
}
