'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';

/**
 * Arama sonucu önizlemesi.
 *
 * Arama motorları uzun başlığı ve açıklamayı keser; karakter sınırının neden
 * var olduğunu sayaçtan çok bu kart anlatıyor. Kesme noktaları yaklaşık —
 * gerçek kesim piksel genişliğine göre yapılır.
 */
export function SeoPreview({
  url,
  title,
  description,
}: {
  url: string;
  title: string;
  description: string;
}): ReactNode {
  const host = hostOf(url);
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('editor.seoPreview')}
      </figcaption>
      <div className="rounded-lg border border-border bg-white p-3 text-left dark:bg-card">
        <p className="truncate text-xs text-[#4d5156] dark:text-muted-foreground">{host}</p>
        <p className="mt-0.5 line-clamp-1 text-base leading-snug text-[#1a0dab] dark:text-sky-400">
          {clip(title, 60) || '—'}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[#4d5156] dark:text-muted-foreground">
          {clip(description, 155) || '—'}
        </p>
      </div>
    </figure>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
