import { cn } from '@/lib/cn';

/**
 * Yükleme iskeleti.
 *
 * "Yükleniyor…" metni yerine kullanılıyor çünkü metin, gelen içerikten farklı
 * yükseklikte: liste dolduğunda sayfa zıplıyor ve 11.1'in CLS 0 ölçümü
 * bozuluyordu. İskelet, gerçek içeriğin yerini ÖNCEDEN tutuyor.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer bg-line',
        'bg-[linear-gradient(90deg,transparent_0%,color-mix(in_oklab,var(--brand-text)_6%,transparent)_50%,transparent_100%)]',
        'bg-[length:200%_100%]',
        className,
      )}
      style={{ borderRadius: 'var(--brand-radius)' }}
    />
  );
}
