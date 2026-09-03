'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Step } from './machine';
import { t } from '@/i18n/tr';

const STEP_LABEL: Record<Step, string> = {
  branch: t('booking.step.branch'),
  service: t('booking.step.service'),
  staff: t('booking.step.staff'),
  datetime: t('booking.step.datetime'),
  identity: t('booking.step.identity'),
  consent: t('booking.step.consent'),
  confirm: t('booking.step.confirm'),
  done: '',
};

/**
 * İlerleme göstergesi.
 *
 * Adım dizisi `stepsFor(settings)`ten geliyor; kapalı ayarlarda (`staff`,
 * `identity`, `consent`) sayı kendiliğinden doğru — gizlenen değil ÇIKARILAN
 * adım mantığının görsel karşılığı bu.
 *
 * Mobilde altı etiketi yan yana sıkıştırmak yerine sayaç + çubuk var: dört
 * karaktere kırpılmış etiketler ilerlemeyi anlatmıyor, yer kaplıyordu.
 */
export function Stepper({
  steps,
  current,
  onGoto,
}: {
  steps: Step[];
  current: Step;
  onGoto: (step: Step) => void;
}) {
  // Açık tip: TS 5.5 `filter`ten tip koruyucu çıkarıyor ve `Exclude<Step,'done'>[]`
  // dizisi `current: Step` ile aranamıyor.
  const visible: Step[] = steps.filter((step) => step !== 'done');
  const index = visible.indexOf(current);
  // Payda adım SAYISI (aralık sayısı değil): ilk adımda bomboş bir çubuk
  // "hiçbir şey yapılmadı" diyor, oysa kullanıcı akışın ilk adımında.
  const progress = (Math.max(0, index) + 1) / Math.max(1, visible.length);

  return (
    <div>
      {/* --- Mobil --- */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">{STEP_LABEL[current]}</p>
          <p className="text-xs opacity-55">
            {t('booking.step.counter', { current: index + 1, total: visible.length })}
          </p>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full transition-[width] duration-(--dur-base) ease-(--ease-out)"
            style={{ width: `${Math.round(progress * 100)}%`, background: 'var(--brand-primary)' }}
          />
        </div>
      </div>

      {/* --- Masaüstü --- */}
      <ol className="hidden sm:flex sm:items-center">
        {visible.map((step, position) => {
          const done = position < index;
          const active = step === current;
          return (
            <li key={step} className={cn('flex items-center', position > 0 && 'flex-1')}>
              {position > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'mx-2 h-px flex-1 transition-colors duration-(--dur-base)',
                    done || active ? 'bg-brand' : 'bg-line',
                  )}
                />
              )}
              <button
                type="button"
                // Yalnız GERİYE gidilebiliyor: ileri sıçramak `canAdvance`
                // kuralını atlar ve doğrulanmamış bir seçimle ilerlemek olurdu.
                disabled={!done}
                aria-current={active ? 'step' : undefined}
                onClick={() => {
                  onGoto(step);
                }}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap transition-opacity duration-(--dur-fast)',
                  done ? 'opacity-70 hover:opacity-100' : active ? 'opacity-100' : 'opacity-40',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors duration-(--dur-base)',
                    done && 'border-brand bg-brand text-white',
                    active && 'border-brand text-brand-ink ring-2 ring-brand-ring',
                    !done && !active && 'border-line-strong',
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : position + 1}
                </span>
                <span className={cn('text-xs', active && 'font-semibold')}>
                  {STEP_LABEL[step]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export { STEP_LABEL };
