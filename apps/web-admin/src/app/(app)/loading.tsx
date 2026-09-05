import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** Rota geçişlerinde "Yükleniyor…" metni yerine sayfanın iskeleti. */
export default function AppLoading(): ReactNode {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <Skeleton key={key} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
