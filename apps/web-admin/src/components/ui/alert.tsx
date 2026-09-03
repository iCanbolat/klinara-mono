import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type AlertTone = 'info' | 'danger' | 'warn' | 'ok';

const TONES: Record<AlertTone, string> = {
  info: 'bg-muted border-line-strong text-ink',
  danger: 'bg-danger-soft border-danger text-ink',
  warn: 'bg-warn-soft border-warn text-ink',
  ok: 'bg-ok-soft border-ok text-ink',
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
      className={cn('rounded-md border px-3 py-2 text-sm', TONES[tone], className)}
    >
      {title !== undefined ? <p className="font-medium">{title}</p> : null}
      {children}
    </div>
  );
}
