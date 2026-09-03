'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-ink hover:opacity-90',
        secondary: 'bg-card text-ink border border-line-strong hover:bg-muted',
        ghost: 'text-ink hover:bg-muted',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean;
}

/**
 * Yükleme durumunda çocuklar MOUNTED kalıyor, üzerine bir katman biniyor.
 *
 * Metni "Yükleniyor…" ile değiştirmek düğmenin genişliğini değiştirir ve
 * altındaki düzen zıplar; ayrıca ekran okuyucu için `aria-busy` zaten doğru
 * sinyal.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(button({ variant, size }), loading && 'relative text-transparent', className)}
      disabled={disabled === true || loading}
      aria-busy={loading}
      {...props}
    >
      {children}
      {loading ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-current"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </span>
      ) : null}
    </button>
  );
});
