'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@/i18n/tr';

/**
 * Galeri şeridi — `scroll-snap` üzerine OK DÜĞMELERİ.
 *
 * Kaydırma hâlâ tarayıcının: dokunmatikte parmakla, masaüstünde trackpad ile
 * çalışıyor ve JS yüklenmeden de şerit kullanılabilir. Bu ada yalnız iki şey
 * ekliyor: fareyle gezinen için ok düğmeleri ve uçlarda düğmelerin kapanması.
 * Sığan öge sayısı az olduğunda şerit ortalanıyor (`justify-center-safe`: taşma
 * varsa başa hizalanır, ilk öge kesilmez).
 *
 * Bir carousel kütüphanesi burada hem bundle hem erişilebilirlik borcu olurdu;
 * düğmeler gerçek `<button>`, şerit gerçek bir liste.
 */
export function GalleryCarousel({ label, children }: { label: string; children: ReactNode }) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (track === null) return;
    // 2px tolerans: alt piksel yuvarlaması uçtayken bile 1px kaydırma bırakabiliyor.
    setEdges({
      start: track.scrollLeft <= 2,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    measure();
    track.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      track.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure]);

  function scroll(direction: -1 | 1): void {
    const track = trackRef.current;
    if (track === null) return;
    // Bir "sayfa" = görünen genişliğin çoğu; snap bir sonraki ögeye oturtuyor.
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
  }

  const overflowing = !(edges.start && edges.end);

  return (
    <div className="relative">
      <ul
        ref={trackRef}
        aria-label={label}
        className="scrollbar-none flex snap-x snap-mandatory justify-center-safe gap-4 overflow-x-auto scroll-smooth scroll-px-4 px-4 pb-2 sm:scroll-px-6 sm:gap-5 sm:px-6 lg:scroll-px-8 lg:px-8"
      >
        {children}
      </ul>

      {overflowing ? (
        <div className="mt-5 flex justify-center gap-2">
          <ArrowButton label={t('block.gallery.prev')} disabled={edges.start} onClick={() => scroll(-1)}>
            <ChevronLeft aria-hidden="true" className="size-5" />
          </ArrowButton>
          <ArrowButton label={t('block.gallery.next')} disabled={edges.end} onClick={() => scroll(1)}>
            <ChevronRight aria-hidden="true" className="size-5" />
          </ArrowButton>
        </div>
      ) : null}
    </div>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 items-center justify-center rounded-full border border-line-strong bg-card text-ink shadow-sm transition hover:border-brand hover:text-brand disabled:cursor-default disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink"
    >
      {children}
    </button>
  );
}
