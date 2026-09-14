'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Bölümlü düğme grubu — takvim görünümü ve liste tablo/kart geçişi.
 *
 * Radyo değil `aria-pressed` düğmeler: ok tuşu gezinmesi beklenmiyor ve her
 * seçenek tek başına bir eylem.
 */
export function Segmented({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-card p-0.5"
    >
      {children}
    </div>
  );
}

export function SegmentButton({
  pressed,
  onClick,
  children,
  ...props
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  'aria-label'?: string;
  title?: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors [&_svg]:size-4',
        pressed ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
      )}
      {...props}
    >
      {children}
    </button>
  );
}
