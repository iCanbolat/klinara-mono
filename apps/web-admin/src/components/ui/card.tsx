import type { ReactNode, ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/*
 * iOS `KlinaraCard` karşılığı: dolgu + 1px kenarlık, GÖLGE YOK.
 *
 * shadcn'in kendi `Card`ı `py-6` + `gap-6` ile geliyor ve yatay dolgusunu
 * `CardHeader`/`CardContent`e bırakıyor. Buradaki 40+ çağrı yeri ise içeriği
 * doğrudan `<Card>` içine koyuyor; o yüzden dolgu kartın kendisinde duruyor ve
 * alt parçalar yatay dolgu EKLEMİYOR.
 */
export function Card({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="card"
      className={cn('rounded-xl border border-border bg-card p-5 text-card-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'mb-4 flex items-start justify-between gap-4 has-data-[slot=card-action]:flex-row',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>): ReactNode {
  return (
    <h2 data-slot="card-title" className={cn('text-title-m text-foreground', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>): ReactNode {
  return (
    <p
      data-slot="card-description"
      className={cn('mt-1 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Başlık hizasında sağa yaslanan aksiyon slotu. */
export function CardAction({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div data-slot="card-action" className={cn('shrink-0', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>): ReactNode {
  return (
    <div
      data-slot="card-footer"
      className={cn('mt-4 flex items-center gap-2 border-t border-border pt-4', className)}
      {...props}
    />
  );
}
