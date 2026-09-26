'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/cn';

/*
 * shadcn/ui tabanı — ama bu dosya artık BİZİM.
 *
 * İki bilinçli sapma var, `shadcn add button` tekrar çalıştırılırsa geri
 * konmalı:
 *   1. Gölge yok. iOS tasarım sisteminde sıfır shadow; derinlik yalnız dolgu +
 *      1px kenarlık ile ifade ediliyor (bkz. `globals.css` başlığı).
 *   2. `focus-visible:ring-*` yok. Odak halkası `globals.css`teki tek global
 *      `:focus-visible` kuralından geliyor; iki gösterge üst üste binmemeli.
 *
 * Variant adları shadcn'inkiler DEĞİL; panelin mevcut sözlüğü korunuyor
 * (`primary`/`secondary`/`ghost`/`danger`) — 30+ çağrı yerini tek seferde
 * değiştirmek, kazandırdığından çok risk taşırdı. shadcn adları da eşanlamlı
 * olarak kabul ediliyor ki `ui/` içindeki diğer komponentler çalışsın.
 */
const button = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg',
    'font-semibold whitespace-nowrap transition-colors',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border border-border bg-card text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        danger: 'bg-destructive text-white hover:bg-destructive/90',
        link: 'text-secondary-foreground underline-offset-4 hover:underline',
        // shadcn eşanlamlıları — `ui/` içindeki komponentler bu adları kullanıyor.
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-card text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
      },
      size: {
        // 44px taban: iOS'ta hiçbir etkileşimli öge 44pt altına inmiyor.
        md: 'h-11 px-5 text-base has-[>svg]:px-4',
        sm: 'h-9 gap-1.5 px-3 text-sm has-[>svg]:px-2.5',
        lg: 'h-12 px-6 text-base has-[>svg]:px-5',
        icon: 'size-11',
        'icon-sm': 'size-9',
        // shadcn eşanlamlısı.
        default: 'h-11 px-5 text-base has-[>svg]:px-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

// Yüklemede metin `text-transparent`; spinner rengini `currentColor`dan alamaz.
const spinnerColor: Record<NonNullable<VariantProps<typeof button>['variant']>, string> = {
  primary: 'text-primary-foreground',
  default: 'text-primary-foreground',
  danger: 'text-white',
  destructive: 'text-white',
  secondary: 'text-foreground',
  outline: 'text-foreground',
  ghost: 'text-foreground',
  link: 'text-secondary-foreground',
};

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof button> {
  loading?: boolean;
  asChild?: boolean;
}

/**
 * Yükleme durumunda çocuklar MOUNTED kalıyor, üzerine bir katman biniyor.
 *
 * Metni "Yükleniyor…" ile değiştirmek düğmenin genişliğini değiştirir ve
 * altındaki düzen zıplar; ayrıca ekran okuyucu için `aria-busy` zaten doğru
 * sinyal.
 */
export function Button({
  className,
  variant,
  size,
  loading = false,
  asChild = false,
  disabled,
  children,
  ...props
}: ButtonProps): React.ReactNode {
  const className_ = cn(
    button({ variant, size }),
    // Düğme soluklaşmıyor; içerik gizlenip yerine spinner geliyor.
    loading && 'relative text-transparent disabled:opacity-100 [&>*:not([data-spinner])]:invisible',
    className,
  );

  /*
   * `asChild` yolunda çocuk TEK olmalı.
   *
   * Radix `Slot` özniteliklerini tek bir React ögesine devrediyor; yanına
   * koşullu bir spinner koymak — koşul `null` dönse bile — çocuğu diziye
   * çevirip "Slot failed to slot onto its children" hatası veriyor. `asChild`
   * zaten bağlantılar (`<Link>`) için ve onların yükleme durumu yok.
   */
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={className_} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      data-slot="button"
      className={className_}
      disabled={disabled === true || loading}
      aria-busy={loading}
      {...props}
    >
      {children}
      {loading ? (
        <span
          data-spinner
          aria-hidden="true"
          className={cn(
            'absolute inset-0 flex items-center justify-center',
            spinnerColor[variant ?? 'primary'],
          )}
        >
          <Loader2 className="size-5 animate-spin" />
        </span>
      ) : null}
    </button>
  );
}

export { button as buttonVariants };
