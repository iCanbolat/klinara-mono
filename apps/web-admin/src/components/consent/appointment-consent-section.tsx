'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FileSignature } from 'lucide-react';
import { PERMISSIONS, type ConsentRequirements } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { useSession } from '@/components/session/session-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Randevu panelinde onam durumu ve "Onam al" girişi.
 *
 * `version` her durum değişiminde artıyor; panel onu `refreshKey` olarak
 * geçirerek imza modundan dönüşte ya da bir geçişten sonra durumu tazeliyor.
 */
export function AppointmentConsentSection({
  appointmentId,
  refreshKey,
}: {
  appointmentId: string;
  refreshKey: number;
}): ReactNode {
  const { permissions } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [requirements, setRequirements] = useState<ConsentRequirements | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRead = permissions.includes(PERMISSIONS.CONSENT_READ);
  const canCollect = permissions.includes(PERMISSIONS.CONSENT_COLLECT);

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await api.get<ConsentRequirements>(
          `appointments/${appointmentId}/consent-requirements`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setRequirements(result);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [appointmentId, refreshKey, canRead]);

  if (!canRead) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-label">{t('consent.required.title')}</h3>
        {requirements !== null && requirements.items.length > 0 ? (
          <Badge variant={requirements.missingCount > 0 ? 'default' : 'secondary'}>
            {requirements.missingCount > 0
              ? t('consent.required.missing', { count: requirements.missingCount })
              : t('consent.required.ok')}
          </Badge>
        ) : null}
      </div>

      {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}

      {requirements === null ? null : requirements.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('consent.required.none')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {requirements.items.map((item) => (
            <li
              key={`${item.kind}-${item.templateId ?? 'kvkk'}`}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{item.title}</span>
              <span
                className={
                  item.satisfied
                    ? 'text-xs text-muted-foreground'
                    : 'text-xs font-semibold text-warning'
                }
              >
                {item.satisfied
                  ? item.signatureId === null
                    ? t('consent.required.acceptedOnline')
                    : t('consent.required.signed')
                  : t('consent.required.pending')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canCollect && requirements !== null && requirements.missingCount > 0 ? (
        <Button
          type="button"
          size="sm"
          className="self-start"
          onClick={() =>
            router.push(`/imza/randevu/${appointmentId}?donus=${encodeURIComponent(pathname)}`)
          }
        >
          <FileSignature aria-hidden="true" />
          {t('consent.required.collect')}
        </Button>
      ) : null}
    </section>
  );
}
