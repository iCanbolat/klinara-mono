import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * Marka işareti.
 *
 * Raster, çünkü elimizde vektör master YOK — gerekçe ve üretim yolu için
 * `assets/brand/README.md`. Görsel `tools/brand/build-icons.mjs` tarafından
 * kaynak logodan türetiliyor; elle düzenlenmemeli.
 *
 * `next/image` yerine düz `<img>` DEĞİL: boyut sabit ve dosya yerel, optimizasyon
 * bedava. `priority` yok, çünkü kenar çubuğunda ilk boyada kritik değil.
 */
export function KlinaraMark({ size = 28, className }: { size?: number; className?: string }): ReactNode {
  return (
    <Image
      src="/brand/klinara-mark.png"
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden="true"
    />
  );
}

/**
 * İşaret + kelime markası — iOS `KlinaraWordmark` karşılığı.
 *
 * "KLINARA" resimden değil METİNDEN geliyor: serif ailesi zaten yüklü, metin her
 * ölçekte keskin ve ekran okuyucu markayı okuyabiliyor.
 */
export function KlinaraWordmark({
  markSize = 32,
  className,
}: {
  markSize?: number;
  className?: string;
}): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <KlinaraMark size={markSize} />
      <span className="text-title-m leading-none tracking-[0.28em] text-foreground">KLINARA</span>
    </span>
  );
}
