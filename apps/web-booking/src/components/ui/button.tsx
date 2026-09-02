'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * shadcn/ui kalıbı, kiracı temasına bağlanmış hâli.
 *
 * Renkler Tailwind paletinden değil `--brand-*` custom property'lerinden
 * geliyor: aksi hâlde her kiracı sayfası aynı maviyi gösterirdi.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2',
  {
    variants: {
      variant: {
        primary: 'text-white hover:opacity-90',
        outline: 'border border-current/25 hover:bg-black/5',
        ghost: 'hover:bg-black/5',
      },
      size: {
        md: 'h-11 px-5',
        sm: 'h-9 px-3 text-xs',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, style, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      style={{
        borderRadius: 'var(--brand-radius)',
        ...(variant === 'primary' || variant === undefined
          ? { background: 'var(--brand-primary)' }
          : {}),
        ...style,
      }}
      {...props}
    />
  );
}

export { buttonVariants };
