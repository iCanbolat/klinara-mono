import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type AlertTone = 'info' | 'danger' | 'warn' | 'ok';

/*
 * iOS `ErrorBanner`ın web karşılığı: yumuşak dolgu + tam tonlu kenarlık,
 * `controlRadius` (12px), gölge yok.
 */
const TONES: Record<AlertTone, string> = {
  info: 'border-border bg-muted text-foreground',
  danger: 'border-destructive/35 bg-destructive-soft text-foreground',
  warn: 'border-warning/35 bg-warning-soft text-foreground',
  ok: 'border-success/35 bg-success-soft text-foreground',
};

/**
 * `role` seçimi bilinçli: hata ve uyarı `alert` (kesintili duyuru), bilgi ve
 * başarı `status` (kibar duyuru). Her şeyi `alert` yapmak ekran okuyucu
 * kullanıcısının işini bölerdi.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {title !== undefined ? <p className="text-body-emphasis">{title}</p> : null}
      {children}
    </div>
  );
}
