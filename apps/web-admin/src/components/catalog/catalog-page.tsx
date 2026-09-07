'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Service, type ServiceCategorySummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/format/money';
import { ServiceFormDialog } from './service-form';

/**
 * Hizmet katalogu.
 *
 * ---------------------------------------------------------------------------
 * SALT OKUNUR ROL MENÜDE VAR, DÜĞMELER YOK
 * ---------------------------------------------------------------------------
 * Resepsiyon `service:read` taşıyor ama `service:write` taşımıyor. Menüden
 * çıkarmak yanlış olurdu: resepsiyon "bu hizmet kaç dakika, kaç lira"
 * sorusunu sormak zorunda ve cevabı burada. Bu yüzden ekran görünüyor,
 * yazma düğmeleri render edilmiyor ve sebebi bir satırla yazılıyor.
 *
 * `DELETE /services/:id` SİLMİYOR, pasife alıyor (200 + gövde). Arayüz de
 * "sil" demiyor — geçmiş randevular o hizmete bağlı ve silinemez.
 */
export function CatalogPage(): ReactNode {
  const { permissions } = useSession();
  const [services, setServices] = useState<Service[] | null>(null);
  const [categories, setCategories] = useState<ServiceCategorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const canWrite = permissions.includes(PERMISSIONS.SERVICE_WRITE);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const [serviceList, categoryList] = await Promise.all([
          api.get<{ data: Service[] }>('services', { signal: controller.signal }),
          api.get<{ data: ServiceCategorySummary[] }>('service-categories', {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        setServices(serviceList.data);
        setCategories(categoryList.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [nonce]);

  async function deactivate(service: Service): Promise<void> {
    setBusy(service.id);
    setError(null);
    try {
      await api.delete(`services/${service.id}`);
      toast.success(t('catalog.deactivated'));
      reload();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const categoryName = (id: string): string =>
    categories.find((category) => category.id === id)?.name ?? '—';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('catalog.title')}
        actions={
          canWrite ? (
            <Button type="button" onClick={() => setCreating(true)}>
              {t('catalog.newService')}
            </Button>
          ) : undefined
        }
      />

      {!canWrite ? <Alert tone="info">{t('catalog.readOnly')}</Alert> : null}

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {services === null && error === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {services !== null && services.length === 0 ? <EmptyState title={t('catalog.empty')} /> : null}

      {services !== null && services.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('catalog.title')}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('catalog.name')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('catalog.category')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('catalog.duration')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('catalog.price')}
                </th>
                <th scope="col" className="py-2" />
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id} className="border-b border-border/60">
                  <td className="py-2 pr-3">
                    {service.name}
                    {!service.isActive ? (
                      <span className="ml-2 text-xs text-muted-foreground">pasif</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{categoryName(service.categoryId)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{service.durationMinutes}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatMoney(service.priceMinor)}
                  </td>
                  <td className="py-2 text-right">
                    {canWrite ? (
                      <span className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => setEditing(service)}
                        >
                          {t('customers.save')}
                        </Button>
                        {service.isActive ? (
                          <ConfirmButton
                            variant="danger"
                            size="sm"
                            disabled={busy !== null}
                            title={t('customers.deactivate')}
                            // "Sil" DEĞİL: geçmiş randevular bu hizmete
                            // bağlı ve silinemez.
                            description={service.name}
                            onConfirm={() => void deactivate(service)}
                          >
                            {t('customers.deactivate')}
                          </ConfirmButton>
                        ) : null}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ServiceFormDialog
        open={creating || editing !== null}
        service={editing}
        categories={categories}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          reload();
        }}
      />
    </div>
  );
}
