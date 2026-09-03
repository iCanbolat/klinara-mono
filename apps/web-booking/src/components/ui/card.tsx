import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Akışın taşıyıcı yüzeyi.
 *
 * Zemin ve bordür `--surface-card` / `--border-subtle` üzerinden geliyor;
 * ikisi de kiracının kendi renklerinden türetiliyor (bkz. `globals.css`).
 * `bg-white` yazmak koyu palet seçen bir kiracıda kartı görünmez yapardı.
 */
export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border border-line bg-card shadow-card', className)}
      style={{ borderRadius: 'var(--brand-radius)' }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
        {subtitle !== undefined && (
          <p className="mt-1 text-sm opacity-65">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-5 sm:px-6 sm:py-6', className)} {...props}>
      {children}
    </div>
  );
}
