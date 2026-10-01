'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { GitMerge, Pencil } from 'lucide-react';
import { PERMISSIONS, type Customer } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CustomerFormDialog } from './customer-form';
import { CustomerProfile } from './customer-profile';
import { usePageCrumb } from '@/components/shell/page-crumb';
import { CustomerConsentsPanel } from '@/components/consent/customer-consents-panel';
import { FilesPanel } from './files-panel';
import { MergeDialog } from './merge-dialog';
import { NotesPanel } from './notes-panel';
import { TimelinePanel } from './timeline-panel';

/** Sekme içeriği: kart sabit yükseklikteyken yalnız bu alan kayar. */
const PANEL = 'min-h-0 lg:-mr-2 lg:overflow-y-auto lg:pr-2';

/**
 * Müşteri kartı.
 *
 * ---------------------------------------------------------------------------
 * RANDEVU İZNİ OLMAYANA ZAMAN TÜNELİ SEKMESİ HİÇ RENDER EDİLMİYOR
 * ---------------------------------------------------------------------------
 * `customer:read` taşıyıp `appointment:read.*` taşımayan bir rol (özel
 * yapılandırılmış bir kiracı rolü) `GET /customers/:id/timeline`ten 403 alır
 * ve boş bir "Geçmiş" sekmesi görürdü — yani "bu müşterinin hiç randevusu
 * yok" derdi.
 *
 * Sekme izne göre HİÇ render edilmiyor.
 */
export function CustomerCard({ customerId }: { customerId: string }): ReactNode {
  const { permissions } = useSession();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [nonce, setNonce] = useState(0);

  const canWrite = permissions.includes(PERMISSIONS.CUSTOMER_WRITE);
  const canMerge = permissions.includes(PERMISSIONS.CUSTOMER_MERGE);
  usePageCrumb(customer?.fullName ?? null);

  const canSeeConsents = permissions.includes(PERMISSIONS.CONSENT_READ);

  const canSeeTimeline =
    permissions.includes(PERMISSIONS.APPOINTMENT_READ_ALL) ||
    permissions.includes(PERMISSIONS.APPOINTMENT_READ_OWN);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const result = await api.get<Customer>(`customers/${customerId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCustomer(result);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [customerId, nonce]);

  if (error !== null) {
    return (
      <Alert tone="danger">
        <span role="alert">{error}</span>
      </Alert>
    );
  }

  if (customer === null) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={customer.fullName}
        {...(customer.phone === null ? {} : { description: customer.phone })}
        actions={
          <span className="flex flex-wrap gap-2">
            {canMerge ? (
              <Button type="button" variant="ghost" onClick={() => setMerging(true)}>
                <GitMerge aria-hidden="true" />
                {t('customers.merge.title')}
              </Button>
            ) : null}
            {canWrite ? (
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                {t('customers.edit')}
              </Button>
            ) : null}
          </span>
        }
      />

      {customer.mergedIntoCustomerId !== null ? (
        <Alert tone="warn" className="mb-6">
          {t('customers.inactive')}
        </Alert>
      ) : null}

      {/* Geniş ekranda iki kart SABİT yükseklikte yan yana; uzun içerik
          sayfayı değil kartın içini kaydırıyor. Sekme şeridi yerinde kalıyor,
          yalnız sekme içeriği kayıyor. Dar ekranda kartlar alt alta ve doğal
          yükseklikte — orada sabit yükseklik iç içe iki kaydırma yaratırdı. */}
      <div className="grid gap-6 lg:h-[calc(100dvh-15rem)] lg:min-h-[520px] lg:grid-cols-[18rem_minmax(0,1fr)]">
        <CustomerProfile customer={customer} className="lg:min-h-0 lg:overflow-y-auto" />

        <Card className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-hidden">
          <Tabs defaultValue="notes" className="min-h-0 flex-1 gap-5">
            <TabsList className="shrink-0">
              <TabsTrigger value="notes">{t('customers.tab.notes')}</TabsTrigger>
              {/* Randevu izni yoksa HİÇ render edilmiyor — bkz. dosya başlığı. */}
              {canSeeTimeline ? (
                <TabsTrigger value="timeline">{t('customers.tab.timeline')}</TabsTrigger>
              ) : null}
              <TabsTrigger value="files">{t('customers.tab.files')}</TabsTrigger>
              {canSeeConsents ? (
                <TabsTrigger value="consents">{t('consent.required.title')}</TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="notes" className={PANEL}>
              <NotesPanel customerId={customerId} />
            </TabsContent>

            {canSeeTimeline ? (
              <TabsContent value="timeline" className={PANEL}>
                <TimelinePanel customerId={customerId} />
              </TabsContent>
            ) : null}

            <TabsContent value="files" className={PANEL}>
              <FilesPanel customerId={customerId} canWrite={canWrite} />
            </TabsContent>

            {canSeeConsents ? (
              <TabsContent value="consents" className={PANEL}>
                <CustomerConsentsPanel customerId={customerId} />
              </TabsContent>
            ) : null}
          </Tabs>
        </Card>
      </div>

      <CustomerFormDialog
        open={editing}
        customer={customer}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setCustomer(saved);
          setEditing(false);
        }}
      />

      {canMerge ? (
        <MergeDialog
          open={merging}
          survivor={customer}
          onClose={() => setMerging(false)}
          onDone={() => {
            setMerging(false);
            setNonce((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}
