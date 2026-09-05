import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Sayfa başlığı — serif `displayM`, iOS'taki `AuthScaffold` başlığıyla aynı stil.
 * `actions` sağa yaslanıyor ve dar ekranda başlığın ALTINA düşüyor.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn('mb-8 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-display-m text-foreground">{title}</h1>
        {description === undefined ? null : (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
