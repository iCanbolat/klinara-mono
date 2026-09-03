import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn('rounded-lg border border-line bg-card p-4 shadow-sm', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }): ReactNode {
  return <h2 className="mb-3 text-base font-semibold text-ink">{children}</h2>;
}
