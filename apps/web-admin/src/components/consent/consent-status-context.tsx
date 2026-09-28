'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileWarning } from 'lucide-react';
import { PERMISSIONS, type AppointmentConsentStatus } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { useSession } from '@/components/session/session-provider';

/**
 * Takvim bloklarında "onam eksik" işareti.
 *
 * Bloklar üç farklı ızgarada (gün, hafta, ajanda) çiziliyor; durum her
 * birine prop olarak taşınmak yerine bağlamdan okunuyor. Veri tek toplu
 * istekle geliyor (`GET consent-statuses?ids=`), blok başına istek YOK.
 *
 * Sessiz başarısızlık bilinçli: işaret yardımcı bir ipucu. Yüklenemezse
 * takvim işaretsiz çizilir; randevu panelindeki onam bölümü asıl kaynak.
 */

const ConsentStatusContext = createContext<ReadonlyMap<string, AppointmentConsentStatus>>(
  new Map(),
);

export function useConsentStatus(appointmentId: string): AppointmentConsentStatus | undefined {
  return useContext(ConsentStatusContext).get(appointmentId);
}

/** Sunucunun kabul ettiği en fazla id sayısı. */
const MAX_IDS = 500;

export function ConsentStatusProvider({
  appointmentIds,
  children,
}: {
  appointmentIds: readonly string[];
  children: ReactNode;
}): ReactNode {
  const { permissions } = useSession();
  const canRead = permissions.includes(PERMISSIONS.CONSENT_READ);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, AppointmentConsentStatus>>(
    () => new Map(),
  );

  // Takvim yoklaması aynı id listesini tekrar tekrar üretiyor; anahtar
  // değişmedikçe yeniden istek atılmıyor.
  const key = useMemo(
    () => [...new Set(appointmentIds)].sort().slice(0, MAX_IDS).join(','),
    [appointmentIds],
  );

  useEffect(() => {
    if (!canRead || key === '') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const rows = await api.get<
          Array<{ appointmentId: string; status: AppointmentConsentStatus }>
        >(`consent-statuses?ids=${key}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatuses(new Map(rows.map((row) => [row.appointmentId, row.status])));
      } catch {
        // Bkz. dosya başlığı: işaret yardımcı, hata ekrana basılmıyor.
      }
    })();
    return () => controller.abort();
  }, [key, canRead]);

  return <ConsentStatusContext.Provider value={statuses}>{children}</ConsentStatusContext.Provider>;
}

/** İşaret yalnız henüz işlemi bitmemiş randevularda anlamlı. */
const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed', 'arrived', 'in_progress']);

/** "Onam eksik" işareti — blokta ve ajanda satırında. */
export function ConsentMissingMark({
  appointmentId,
  appointmentStatus,
  className,
}: {
  appointmentId: string;
  appointmentStatus: string;
  className?: string;
}): ReactNode {
  const status = useConsentStatus(appointmentId);
  if (status !== 'missing' || !ACTIVE_STATUSES.has(appointmentStatus)) return null;
  return (
    <FileWarning
      role="img"
      aria-label={t('consent.calendar.missing')}
      className={cn('inline size-3.5 shrink-0 text-warning', className)}
    >
      <title>{t('consent.calendar.missing')}</title>
    </FileWarning>
  );
}
