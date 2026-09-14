'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Service, type ServiceCategorySummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import { matchesStatus, StatusSelect, type StatusFilter } from '@/components/data-page/status-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Field, FieldSelect } from '@/components/ui/field';
import { formatMoney } from '@/lib/format/money';
import { ServiceCard } from './service-card';
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
 *
 * `GET /services` sayfalanmıyor: tüm liste elde, süzme ve sayfalama istemcide.
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

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

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

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    return (services ?? []).filter(
      (service) =>
        (needle === '' || service.name.toLocaleLowerCase('tr').includes(needle)) &&
        (categoryId === '' || service.categoryId === categoryId) &&
        matchesStatus(status, service.isActive),
    );
  }, [services, query, categoryId, status]);

  const isFiltered = query.trim() !== '' || categoryId !== '' || status !== 'all';

  const renderActions = (service: Service): ReactNode =>
    canWrite ? (
      <>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => setEditing(service)}
        >
          {t('catalog.edit')}
        </Button>
        {service.isActive ? (
          <ConfirmButton
            variant="danger"
            size="sm"
            disabled={busy !== null}
            title={t('customers.deactivate')}
            // "Sil" DEĞİL: geçmiş randevular bu hizmete bağlı ve silinemez.
            description={service.name}
            onConfirm={() => void deactivate(service)}
          >
            {t('customers.deactivate')}
          </ConfirmButton>
        ) : null}
      </>
    ) : undefined;

  const columns: DataColumn<Service>[] = [
    {
      key: 'name',
      header: t('catalog.name'),
      render: (service) => (
        <>
          {service.name}
          {!service.isActive ? (
            <span className="ml-2 text-xs text-muted-foreground">{t('list.inactive')}</span>
          ) : null}
        </>
      ),
    },
    { key: 'category', header: t('catalog.category'), render: (s) => categoryName(s.categoryId) },
    {
      key: 'duration',
      header: t('catalog.duration'),
      numeric: true,
      render: (service) => service.durationMinutes,
    },
    {
      key: 'price',
      header: t('catalog.price'),
      numeric: true,
      className: 'whitespace-nowrap',
      render: (service) => formatMoney(service.priceMinor),
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('list.actions')}</span>,
            align: 'end' as const,
            render: (service: Service) => (
              <span className="flex justify-end gap-2">{renderActions(service)}</span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <DataPage
        title={t('catalog.title')}
        {...(canWrite
          ? {
              actions: (
                <Button type="button" onClick={() => setCreating(true)}>
                  {t('catalog.newService')}
                </Button>
              ),
            }
          : {})}
        {...(!canWrite ? { notice: <Alert tone="info">{t('catalog.readOnly')}</Alert> } : {})}
        filters={
          <>
            <Field
              label={t('catalog.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <FieldSelect
              label={t('catalog.category')}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">{t('catalog.allCategories')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </FieldSelect>
            <StatusSelect value={status} onChange={setStatus} />
          </>
        }
        rows={filtered}
        rowKey={(service) => service.id}
        loading={services === null && error === null}
        error={error}
        onRetry={reload}
        emptyTitle={isFiltered ? t('list.filteredEmpty') : t('catalog.empty')}
        viewStorageKey="klinara.admin.view.services"
        pagination={{ mode: 'client' }}
        resetKey={`${query}|${categoryId}|${status}`}
        renderTable={(rows) => (
          <DataTable
            caption={t('catalog.title')}
            columns={columns}
            rows={rows}
            rowKey={(service) => service.id}
          />
        )}
        renderCard={(service) => (
          <ServiceCard
            service={service}
            categoryName={categoryName(service.categoryId)}
            {...(canWrite ? { actions: renderActions(service) } : {})}
          />
        )}
      />

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
    </>
  );
}
