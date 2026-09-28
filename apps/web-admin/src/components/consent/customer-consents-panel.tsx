'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, FileSignature } from 'lucide-react';
import {
  PERMISSIONS,
  type ConsentPdfUrl,
  type ConsentRequirements,
  type ConsentSignatureSummary,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Müşteri kartında onamlar: KVKK durumu ve klinikte alınmış imzalı onamlar.
 *
 * ⚠️ PDF adresi yalnız kullanıcı "PDF"e bastığında çekiliyor: `pdf-url` HER
 * çağrıda KVKK erişim kaydı yazıyor (dosyalardaki kural). Listeyi çizerken
 * adres üretmek, kimsenin açmadığı belgeler için erişim kaydı bırakırdı.
 */
export function CustomerConsentsPanel({ customerId }: { customerId: string }): ReactNode {
  const { permissions } = useSession();
  const router = useRouter();
  const [requirements, setRequirements] = useState<ConsentRequirements | null>(null);
  const [signatures, setSignatures] = useState<ConsentSignatureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const canCollect = permissions.includes(PERMISSIONS.CONSENT_COLLECT);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [nextRequirements, nextSignatures] = await Promise.all([
          api.get<ConsentRequirements>(`customers/${customerId}/consent-requirements`, {
            signal: controller.signal,
          }),
          api.get<ConsentSignatureSummary[]>(`customers/${customerId}/consent-signatures`, {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        setRequirements(nextRequirements);
        setSignatures(nextSignatures);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [customerId]);

  async function openPdf(id: string): Promise<void> {
    setOpening(id);
    setError(null);
    try {
      const { url } = await api.get<ConsentPdfUrl>(`consent-signatures/${id}/pdf-url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setOpening(null);
    }
  }

  if (signatures === null || requirements === null) {
    return error !== null ? (
      <Alert tone="danger">
        <span role="alert">{error}</span>
      </Alert>
    ) : (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const kvkkMissing = requirements.missingCount > 0;

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {kvkkMissing ? (
        <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('consent.required.kvkkMissingCustomer')}</span>
          {canCollect ? (
            <Button
              type="button"
              size="sm"
              onClick={() => router.push(`/imza/musteri/${customerId}`)}
            >
              <FileSignature aria-hidden="true" />
              {t('consent.required.collectKvkk')}
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-label">{t('consent.signatures.title')}</h3>
        {signatures.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('consent.signatures.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {signatures.map((signature) => (
              <li key={signature.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="truncate">{signature.documentTitle}</span>
                    <Badge variant="outline">
                      {t('consent.version')} {signature.documentVersion}
                    </Badge>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(signature.signedAt).toLocaleString('tr-TR')} · {signature.signerName}
                    {signature.signerRelation === 'guardian' && signature.guardianOfName !== null
                      ? ` (${t('consent.signatures.guardian', { name: signature.guardianOfName })})`
                      : ''}
                  </span>
                  {signature.collectedBy !== null ? (
                    <span className="text-xs text-muted-foreground">
                      {t('consent.signatures.collectedBy', { name: signature.collectedBy.name })}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={opening === signature.id}
                  disabled={opening !== null}
                  onClick={() => void openPdf(signature.id)}
                >
                  <FileDown aria-hidden="true" />
                  {t('consent.signatures.pdf')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
