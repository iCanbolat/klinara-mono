import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

/**
 * iOS `EmptyStateView` karşılığı: soluk ikon, serif başlık, açıklama ve tek bir
 * ikincil eylem. Eylem `max-w-65` (260px) ile sınırlı — iOS'taki ölçü.
 */
export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  footer,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  footer?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn('flex flex-col items-center gap-4 px-8 py-12 text-center', className)}>
      {Icon === undefined ? null : (
        <Icon aria-hidden="true" className="size-9 stroke-1 text-primary/70" />
      )}
      <h2 className="text-title-m text-foreground">{title}</h2>
      {message === undefined ? null : (
        <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
      )}
      {action === undefined ? null : (
        <Button variant="secondary" className="mt-2 w-full max-w-65" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {footer === undefined ? null : <div className="mt-2">{footer}</div>}
    </div>
  );
}
