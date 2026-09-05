import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Tek sayılık özet kartı.
 *
 * Değer `tabular-nums`: kartlar yan yana dururken rakamların dikey hizası
 * bozulmuyor ve değer güncellendiğinde genişlik zıplamıyor.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading = false,
  className,
}: {
  label: string;
  value?: string;
  hint?: string;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
}): ReactNode {
  return (
    <Card className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label text-muted-foreground">{label}</span>
        {Icon === undefined ? null : (
          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
        )}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <span className="text-display-m tabular-nums text-foreground">{value ?? '—'}</span>
      )}
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}
