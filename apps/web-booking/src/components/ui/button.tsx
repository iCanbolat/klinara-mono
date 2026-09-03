'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * shadcn/ui kalıbı, kiracı temasına bağlanmış hâli.
 *
 * Renkler Tailwind paletinden değil `--brand-*` custom property'lerinden
 * geliyor: aksi hâlde her kiracı sayfası aynı maviyi gösterirdi.
 */
const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background,color,box-shadow,transform] duration-(--dur-fast) ease-(--ease-out) select-none active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2',
  {
    variants: {
      variant: {
        primary: 'text-white shadow-card hover:brightness-110',
        outline: 'border border-line-strong hover:bg-brand-soft',
        ghost: 'hover:bg-brand-soft',
      },
      size: {
        lg: 'h-13 px-6 text-base',
        md: 'h-11 px-5',
        sm: 'h-9 px-3 text-xs',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Gönderim sürerken: içerik yerinde kalır, üstüne spinner biner. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  style,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
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
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* İçerik SÖKÜLMÜYOR, yalnız görünmez oluyor: metni spinner'la
          değiştirmek buton genişliğini oynatır ve satır düzenini zıplatır. */}
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {children}
      </span>
      {loading && (
        <Loader2 className="absolute size-4 animate-spin" aria-hidden />
      )}
    </button>
  );
}

export { buttonVariants };

/**
 * Buton görünümlü BAĞLANTI.
 *
 * `<a><button/></a>` geçersiz HTML (etkileşimli içerik iç içe) ve ekran
 * okuyucuda iki ayrı hedef olarak duyuluyor. Gidilecek bir adres varsa öge
 * bağlantı olmalı, görünüm bunu değiştirmez.
 */
export function LinkButton({
  className,
  variant,
  size,
  style,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & VariantProps<typeof buttonVariants>) {
  return (
    <a
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
