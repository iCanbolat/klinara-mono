'use client';

import { AlertTriangle, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Hata ve bilgi kutusu.
 *
 * `role="alert"` bilerek: hata mesajı görsel değil, ekran okuyucunun da
 * duyması gereken bir olay — akış hata yüzünden duruyorsa kullanıcı bunu
 * yalnız renkten anlamamalı.
 */
export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: 'error' | 'info';
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? AlertTriangle : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex animate-rise-in items-start gap-3 border p-3 text-sm',
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-line bg-raised',
        className,
      )}
      style={{ borderRadius: 'var(--brand-radius)' }}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
