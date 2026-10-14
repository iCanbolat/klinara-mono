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
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMoney } from '@/lib/format/money';
import { ServiceCard } from './service-card';
import { ServiceFormDialog } from './service-form';
import { PackagesTab } from './packages-tab';

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

const TABS = ['services', 'packages'] as const;
type CatalogTab = (typeof TABS)[number];

/** Seçili sekme `?tab=` ile adreste — bkz. `staff-page.tsx`. */
function readTab(): CatalogTab {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? '').get('tab');
    return (TABS as readonly string[]).includes(value ?? '') ? (value as CatalogTab) : 'services';
  } catch {
    return 'services';
  }
}

/**
 * Hizmetler sayfası: iki sekme.
 *   - **Hizmetler** (`service:read`, sayfanın kapısı).
 *   - **Paketler** (`package:read`): paket tanımları hizmetlerden kurulur,
 *     bu yüzden ayrı bir menü ögesi değil, kataloğun bir parçası. Hizmet ve
 *     kategori listesi burada BİR KEZ çekilip iki sekmeye veriliyor.
 */
export function CatalogPage(): ReactNode {
  const { permissions } = useSession();
  const canPackages = permissions.includes(PERMISSIONS.PACKAGE_READ);
  const [services, setServices] = useState<Service[] | null>(null);
  const [categories, setCategories] = useState<ServiceCategorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<CatalogTab>('services');

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    // İlk render sunucuyla aynı olmalı; adresteki sekme mount sonrası okunuyor.
    void (async () => {
      await Promise.resolve();
      const initial = readTab();
      if (initial !== 'services') setTab(initial);
    })();
  }, []);

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

  function changeTab(next: string): void {
    const value = next as CatalogTab;
    setTab(value);
    try {
      const url = new URL(globalThis.location.href);
      if (value === 'services') url.searchParams.delete('tab');
      else url.searchParams.set('tab', value);
      globalThis.history.replaceState(globalThis.history.state, '', url);
    } catch {
      // Adres güncellenemiyorsa sekme yine değişiyor; kaybolan yalnız paylaşım.
    }
  }

  const servicesTab = (
    <ServicesTab
      services={services}
      categories={categories}
      loadError={error}
      reload={reload}
    />
  );

  if (!canPackages) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('catalog.title')} className="mb-0" />
        {servicesTab}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.pageDescription')}
        className="mb-0"
      />
      <Tabs value={tab} onValueChange={changeTab} className="gap-5">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-10">
            <TabsTrigger value="services" className="px-3">
              {t('catalog.tabServices')}
            </TabsTrigger>
            <TabsTrigger value="packages" className="px-3">
              {t('catalog.tabPackages')}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="services">{servicesTab}</TabsContent>
        <TabsContent value="packages">
          <PackagesTab services={services ?? []} categories={categories} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServicesTab({
  services,
  categories,
  loadError,
  reload,
}: {
  services: Service[] | null;
  categories: ServiceCategorySummary[];
  loadError: string | null;
  reload: () => void;
}): ReactNode {
  const { permissions } = useSession();
  const [actionError, setError] = useState<string | null>(null);
  const error = loadError ?? actionError;
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const canWrite = permissions.includes(PERMISSIONS.SERVICE_WRITE);

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
