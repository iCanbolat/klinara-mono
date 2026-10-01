'use client';

import type { ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { AppointmentStatus } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { cn } from '@/lib/cn';
import { STATUS_LABEL, type StatusAction } from '@/lib/calendar/status';

/**
 * Randevunun ilerleme şeridi — aynı zamanda durum DEĞİŞTİRME denetimi.
 *
 * Mutlu yol: planlandı → onaylandı → geldi → işlemde → tamamlandı. Her adım
 * üç durumdan birinde:
 *   - GEÇİLDİ / ŞU AN: bilgi, tıklanmıyor.
 *   - GİDİLEBİLİR: sunucunun geçiş tablosunda var (`statusActions`), tıklanınca
 *     o duruma geçiyor. `planlandı → geldi` gibi adım atlayan geçişler de
 *     böyle; şerit "yalnız bir sonraki" demiyor, tablo ne diyorsa o.
 *   - KİLİTLİ: gidilemez.
 *
 * İzinsiz geçiş (`allowed: false`) etkisiz ama GÖRÜNÜR — bkz. `status.ts`.
 * `tamamlandı`dan `işlemde`ye geri alma da bu yüzden şeritte bir adım olarak
 * çıkıyor: geçildi görünümünde değil, yetkiliyse tıklanabilir bir düğme.
 *
 * `gelmedi` ve `iptal` mutlu yolun DIŞINDA; onlar şeritte değil, panelin ayrı
 * düğmelerinde (geri alınamaz oldukları için ayrı bir onay istiyorlar).
 */

export const STATUS_FLOW = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'completed',
] as const satisfies readonly AppointmentStatus[];

type Flow = (typeof STATUS_FLOW)[number];

export function isFlowStatus(status: AppointmentStatus): status is Flow {
  return (STATUS_FLOW as readonly string[]).includes(status);
}

export function StatusStepper({
  status,
  actions,
  busy,
  onSelect,
}: {
  status: Flow;
  actions: readonly StatusAction[];
  /** Hangi duruma geçiş sürüyor; `null` boşta. Sürerken tüm adımlar etkisiz. */
  busy: string | null;
  onSelect: (to: AppointmentStatus) => void;
}): ReactNode {
  const current = STATUS_FLOW.indexOf(status);

  return (
    <ol aria-label={t('calendar.detail.flow')} className="grid grid-cols-5">
      {STATUS_FLOW.map((step, index) => {
        const action = actions.find((candidate) => candidate.to === step);
        const isCurrent = index === current;
        const done = index < current && action === undefined;
        const reachable = !isCurrent && action !== undefined;
        const loading = busy === step;

        const marker = (
          <span
            className={cn(
              'relative z-10 flex size-7 items-center justify-center rounded-full border-2 text-xs transition-colors',
              isCurrent && 'border-primary bg-primary text-primary-foreground',
              done && 'border-primary bg-primary/15 text-primary',
              reachable &&
                'border-primary bg-background text-primary group-enabled:group-hover:bg-primary/10',
              !isCurrent && !done && !reachable && 'border-border bg-background text-muted-foreground',
              reachable && !action.allowed && 'border-border text-muted-foreground',
            )}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : done || (isCurrent && step === 'completed') ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isCurrent ? 'bg-primary-foreground' : 'bg-current',
                )}
                aria-hidden="true"
              />
            )}
          </span>
        );

        const label = (
          <span
            className={cn(
              'max-w-full truncate text-[11px] leading-tight sm:text-xs',
              isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
              reachable && action.allowed && 'font-medium text-foreground',
            )}
          >
            {t(STATUS_LABEL[step])}
          </span>
        );

        return (
          <li
            key={step}
            className={cn(
              'relative flex justify-center',
              // Bağlayıcı çizgi: bir önceki adımın merkezinden bu adımın
              // merkezine. Şu ana KADAR olan kısım dolu, ötesi silik.
              index > 0 &&
                "before:absolute before:top-[18px] before:right-1/2 before:h-0.5 before:w-full before:-translate-y-1/2 before:content-['']",
              index > 0 && (index <= current ? 'before:bg-primary' : 'before:bg-border'),
            )}
          >
            {reachable ? (
              <button
                type="button"
                className="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg px-0.5 py-1 disabled:cursor-not-allowed"
                disabled={!action.allowed || busy !== null}
                title={action.reasonKey === undefined ? undefined : t(action.reasonKey)}
                onClick={() => onSelect(step)}
              >
                {marker}
                {label}
              </button>
            ) : (
              <div
                className="flex w-full min-w-0 flex-col items-center gap-1.5 px-0.5 py-1"
                aria-current={isCurrent ? 'step' : undefined}
              >
                {marker}
                {label}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
