import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Sekme panellerinin yükleme görünümü.
 *
 * Satır yüksekliği gerçek satırlarınkine yakın tutuluyor: veri gelince içerik
 * ZIPLAMASIN diye. Boş `null` durumunda hiçbir şey çizmemek "kayıt yok" ile
 * "henüz gelmedi"yi aynı gösteriyordu.
 */
export function PanelSkeleton({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
