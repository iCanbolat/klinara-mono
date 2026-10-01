import type { ReactNode } from 'react';
import type { TemplateSegment } from '@klinara/shared';
import { cn } from '@/lib/cn';

/**
 * Şablon gövdesi: düz metin olduğu gibi, değişkenler mavi `@Etiket` olarak.
 *
 * Sayfa `{{…}}` ayrıştırmaz — parçalar sunucudan (`segments`) gelir. Değişken
 * yazılabilir bir metin değil, gönderim anında doldurulan tipli bir alandır;
 * bu yüzden düz metinden renk VE ağırlıkla ayrılır, yalnız renge güvenilmez
 * (renk körü okuyucu `@` işaretinden ve kalınlıktan ayırt eder).
 */
export function TemplateText({
  segments,
  emptyLabel,
  className,
}: {
  segments: readonly TemplateSegment[];
  emptyLabel: string;
  className?: string;
}): ReactNode {
  if (segments.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{emptyLabel}</p>;
  }
  return (
    <p className={cn('text-sm leading-relaxed whitespace-pre-line text-foreground', className)}>
      {segments.map((segment, index) =>
        segment.kind === 'variable' ? (
          <span
            key={index}
            data-variable={segment.name}
            className="rounded-md bg-link-soft px-1 py-0.5 font-semibold text-link"
          >
            {segment.handle}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
