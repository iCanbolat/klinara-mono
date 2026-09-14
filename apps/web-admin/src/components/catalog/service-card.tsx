import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import type { Service } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { formatMoney } from '@/lib/format/money';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/** Hizmet kataloğunun kart görünümü. Eylemler sayfadan geliyor (izne bağlı). */
export function ServiceCard({
  service,
  categoryName,
  actions,
}: {
  service: Service;
  categoryName: string;
  actions?: ReactNode;
}): ReactNode {
  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-body-emphasis">{service.name}</p>
          <p className="truncate text-xs text-muted-foreground">{categoryName}</p>
        </div>
        {!service.isActive ? (
          <Badge variant="outline" className="text-muted-foreground">
            {t('list.inactive')}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
          <Clock aria-hidden="true" className="size-3.5" />
          {service.durationMinutes} dk
        </span>
        <span className="text-body-emphasis tabular-nums">{formatMoney(service.priceMinor)}</span>
      </div>

      {actions === undefined ? null : (
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {actions}
        </div>
      )}
    </Card>
  );
}
