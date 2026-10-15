'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Package } from 'lucide-react';
import { PERMISSIONS, type Service, type ServiceCategorySummary } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { formatMoney } from '@/lib/format/money';
import { toMessage } from '@/lib/reports/errors';
import {
  discountPercent,
  itemsSummary,
  totalSessions,
  type PackageDefinition,
  type PackageDefinitionPage,
} from '@/lib/catalog/package-definitions';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import { matchesStatus, StatusSelect, type StatusFilter } from '@/components/data-page/status-filter';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Field } from '@/components/ui/field';
import { PackageFormDialog } from './package-form';

/**
 * Hizmetler › Paketler — paket TANIMLARI.
 *
 * Tanım bir şablon: satış (müşteri kartı / mobil) bu şablonun o anki
 * kalemlerini ve fiyatını dondurur. Burada satış, bakiye veya iade YOK;
 * proxy de yalnız `package-definitions` uçlarını açıyor.
 *
 * `GET /package-definitions` cursor sayfalamalı ama bir kliniğin tanım sayısı
 * düzinelerle ölçülüyor: tüm sayfalar çekilip süzme istemcide yapılıyor
 * (hizmet listesiyle aynı model).
 *
 * `DELETE` satılmamış tanımı arşivler, satılmışı yalnız pasife alır; arayüz
 * bu yüzden "sil" değil "kaldır" diyor.
 */
export function PackagesTab({
  services,
  categories,
}: {
  services: readonly Service[];
  categories: readonly ServiceCategorySummary[];
}): ReactNode {
  const { permissions } = useSession();
  const { branches, canSelectAll } = useBranch();
  // Tanım yazmak `package_definition:write` (sahip, şube yöneticisi); satış
  // izni (`package:write`) resepsiyonda da var ama tanıma binmez.
  const canWrite = permissions.includes(PERMISSIONS.PACKAGE_DEFINITION_WRITE);
  // Şube yöneticisi tüm şubeleri kapsayan (sahibin) tanımı değiştiremez.
  const canEdit = (definition: PackageDefinition): boolean =>
    canWrite && (canSelectAll || definition.branchId !== null);

  const [definitions, setDefinitions] = useState<PackageDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PackageDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const all: PackageDefinition[] = [];
        let cursor: string | null = null;
        do {
          const path: string =
            cursor === null
              ? 'package-definitions?limit=200'
              : `package-definitions?limit=200&cursor=${encodeURIComponent(cursor)}`;
          const page: PackageDefinitionPage = await api.get<PackageDefinitionPage>(path, {
            signal: controller.signal,
          });
          all.push(...page.data);
          cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
        } while (cursor !== null);
        if (controller.signal.aborted) return;
        setDefinitions(all.sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [nonce]);

  async function retire(definition: PackageDefinition): Promise<void> {
    setBusy(definition.id);
    setError(null);
    try {
      await api.delete(`package-definitions/${definition.id}`, {
        ifMatch: `W/"${String(definition.version)}"`,
      });
      toast.success(t('packages.retired'));
      reload();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    return (definitions ?? []).filter(
      (definition) =>
        (needle === '' ||
          definition.name.toLocaleLowerCase('tr').includes(needle) ||
          definition.items.some((item) =>
            item.serviceName.toLocaleLowerCase('tr').includes(needle),
          )) &&
        matchesStatus(status, definition.isActive),
    );
  }, [definitions, query, status]);

  const isFiltered = query.trim() !== '' || status !== 'all';

  const branchLabel = (id: string | null): string | null =>
    id === null ? null : (branches.find((branch) => branch.id === id)?.name ?? null);

  const validityLabel = (definition: PackageDefinition): string =>
    definition.validityDays === null
      ? t('packages.unlimited')
      : t('packages.days', { count: definition.validityDays });

  const renderActions = (definition: PackageDefinition): ReactNode =>
    canEdit(definition) ? (
      <>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => setEditing(definition)}
        >
          {t('catalog.edit')}
        </Button>
        {definition.isActive ? (
          <ConfirmButton
            variant="danger"
            size="sm"
            disabled={busy !== null}
            title={t('packages.retire')}
            description={`${definition.name} — ${t('packages.retireDescription')}`}
            onConfirm={() => void retire(definition)}
          >
            {t('packages.retire')}
          </ConfirmButton>
        ) : null}
      </>
    ) : undefined;

  const columns: DataColumn<PackageDefinition>[] = [
    {
      key: 'name',
      header: t('packages.colName'),
      render: (definition) => (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{definition.name}</span>
            <PackageBadges definition={definition} branchName={branchLabel(definition.branchId)} />
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {itemsSummary(definition.items)}
          </span>
        </div>
      ),
    },
    {
      key: 'sessions',
      header: t('packages.colSessions'),
      numeric: true,
      render: (definition) => totalSessions(definition.items),
    },
    {
      key: 'validity',
      header: t('packages.colValidity'),
      className: 'whitespace-nowrap',
      render: validityLabel,
    },
    {
      key: 'price',
      header: t('packages.colPrice'),
      numeric: true,
      className: 'whitespace-nowrap',
      render: (definition) => <PriceCell definition={definition} />,
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('list.actions')}</span>,
            align: 'end' as const,
            render: (definition: PackageDefinition) => (
              <span className="flex justify-end gap-2">{renderActions(definition)}</span>
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
                  {t('packages.new')}
                </Button>
              ),
            }
          : {})}
        {...(!canWrite ? { notice: <Alert tone="info">{t('packages.readOnly')}</Alert> } : {})}
        filters={
          <>
            <Field
              label={t('packages.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <StatusSelect value={status} onChange={setStatus} />
          </>
        }
        rows={filtered}
        rowKey={(definition) => definition.id}
        loading={definitions === null && error === null}
        error={error}
        onRetry={reload}
        emptyTitle={isFiltered ? t('list.filteredEmpty') : t('packages.empty')}
        {...(isFiltered ? {} : { emptyMessage: t('packages.emptyMessage') })}
        viewStorageKey="klinara.admin.view.packages"
        pagination={{ mode: 'client' }}
        resetKey={`${query}|${status}`}
        renderTable={(rows) => (
          <DataTable
            caption={t('catalog.tabPackages')}
            columns={columns}
            rows={rows}
            rowKey={(definition) => definition.id}
          />
        )}
        renderCard={(definition) => (
          <Card className="flex h-full flex-col gap-3 p-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Package aria-hidden="true" className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-body-emphasis">{definition.name}</p>
                <span className="flex flex-wrap gap-1.5">
                  <PackageBadges
                    definition={definition}
                    branchName={branchLabel(definition.branchId)}
                  />
                </span>
              </div>
            </div>

            <ul className="flex flex-col gap-1 text-sm">
              {[...definition.items]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground">{item.serviceName}</span>
                    <span className="tabular-nums">× {item.quantity}</span>
                  </li>
                ))}
            </ul>

            <div className="flex items-end justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {t('packages.sessions', { count: totalSessions(definition.items) })} ·{' '}
                {validityLabel(definition)}
              </span>
              <PriceCell definition={definition} />
            </div>

            {canWrite ? (
              <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                {renderActions(definition)}
              </div>
            ) : null}
          </Card>
        )}
      />

      <PackageFormDialog
        open={creating || editing !== null}
        definition={editing}
        services={services}
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

function PackageBadges({
  definition,
  branchName,
}: {
  definition: PackageDefinition;
  branchName: string | null;
}): ReactNode {
  return (
    <>
      {!definition.isActive ? (
        <Badge variant="outline" className="text-muted-foreground">
          {t('list.inactive')}
        </Badge>
      ) : null}
      {branchName !== null ? (
        <Badge variant="outline">{t('packages.branchOnly', { branch: branchName })}</Badge>
      ) : null}
      {definition.isOnlineSellable ? (
        <Badge variant="secondary">{t('packages.online')}</Badge>
      ) : null}
    </>
  );
}

function PriceCell({ definition }: { definition: PackageDefinition }): ReactNode {
  const percent = discountPercent(definition.listPriceMinor, definition.totalPriceMinor);
  return (
    <span className="flex flex-col items-end">
      <span className="text-body-emphasis tabular-nums">
        {formatMoney(definition.totalPriceMinor)}
      </span>
      {percent !== null ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          <s>{formatMoney(definition.listPriceMinor)}</s>{' '}
          <span className="text-primary">{t('packages.discountBadge', { percent })}</span>
        </span>
      ) : null}
    </span>
  );
}
