'use client';

import { Timer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCountdown } from '@/hooks/use-hold-countdown';
import { t } from '@/i18n/tr';

/**
 * Tutma geri sayımı.
 *
 * Son bir dakikada renk DEĞİŞİYOR ve nabız atıyor: kullanıcı süreyi bir
 * sonraki adımda değil, sayaç bitmeden önce fark etmeli (11.2 kabul kriteri).
 */
export function HoldBanner({
  secondsLeft,
  isExpiring,
}: {
  secondsLeft: number;
  isExpiring: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex animate-rise-in items-center gap-2.5 border px-4 py-2.5 text-sm',
        isExpiring
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-line bg-raised',
      )}
      style={{ borderRadius: 'var(--brand-radius)' }}
    >
      <Timer className={cn('size-4 shrink-0', isExpiring && 'animate-pulse-urgent')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {isExpiring ? t('booking.hold.expiring') : t('booking.hold.remaining')}
      </span>
      <strong className="font-mono tabular-nums">{formatCountdown(secondsLeft)}</strong>
    </div>
  );
}
