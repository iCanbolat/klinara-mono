'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MapPin, Phone } from 'lucide-react';
import { PERMISSIONS, type BranchDetail, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import { staffBranchIds } from '@/lib/staff/memberships';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BranchFormDialog } from './branch-form-dialog';

/**
 * Şubeler sekmesi.
 *
 * `GET branches` kiracının TÜM şubelerini (pasifler dahil) döndürüyor; burada
 * hepsi listeleniyor, pasif olan rozetle. Personel sayısı `GET staff`ten —
 * sunucu süzgeciyle aynı kural (`staffBranchIds`), ayrı bir uç gerekmiyor.
 *
 * Kayıttan sonra `BranchProvider` da yenileniyor: yeni şube panelin her
 * şube seçicisinde hemen görünmeli, pasife alınan seçiliyse seçim düşmeli.
 */
export function BranchesTab(): ReactNode {
  const { permissions } = useSession();
  const { reload: reloadProvider } = useBranch();
  const canWrite = permissions.includes(PERMISSIONS.BRANCH_WRITE);

  const [branches, setBranches] = useState<BranchDetail[] | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const [editing, setEditing] = useState<BranchDetail | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const [branchList, staffList] = await Promise.all([
          api.get<{ data: BranchDetail[] }>('branches', { signal: controller.signal }),
          api
            .get<{ data: StaffProfile[] }>('staff', { signal: controller.signal })
            // Sayı bir süs; alınamazsa liste yine çizilmeli.
            .catch(() => ({ data: [] as StaffProfile[] })),
        ]);
        if (controller.signal.aborted) return;
        setBranches(
          [...branchList.data].sort(
            (left, right) =>
              Number(right.isActive) - Number(left.isActive) ||
              left.name.localeCompare(right.name, 'tr'),
          ),
        );
        setStaff(staffList.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [nonce]);

  const staffCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of staff) {
      if (!profile.isActive) continue;
      for (const id of staffBranchIds(profile)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [staff]);

  function saved(): void {
    setEditing(null);
    setCreating(false);
    reload();
    reloadProvider();
  }

  const status = (branch: BranchDetail): ReactNode =>
    branch.isActive ? (
      <Badge variant="secondary">{t('list.statusActive')}</Badge>
    ) : (
      <Badge variant="outline" className="text-muted-foreground">
        {t('branches.inactive')}
      </Badge>
    );

  const editButton = (branch: BranchDetail): ReactNode => (
    <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(branch)}>
      {t('staff.edit')}
    </Button>
  );

  const columns: DataColumn<BranchDetail>[] = [
    {
      key: 'name',
      header: t('branches.name'),
      render: (branch) => (
        <div className="flex flex-col">
          <span className="text-body-emphasis">{branch.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{branch.slug}</span>
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('branches.address'),
      className: 'max-w-72 text-muted-foreground',
      render: (branch) => (
        <div className="flex flex-col gap-0.5">
          <span className="line-clamp-2">{branch.address ?? '—'}</span>
          {branch.phone === null ? null : <span className="text-xs">{branch.phone}</span>}
        </div>
      ),
    },
    { key: 'timezone', header: t('branches.timezone'), render: (branch) => branch.timezone },
    {
      key: 'staff',
      header: t('staff.tabStaff'),
      render: (branch) => t('branches.staffCount', { count: staffCount.get(branch.id) ?? 0 }),
    },
    { key: 'status', header: t('branches.status'), render: status },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('list.actions')}</span>,
            align: 'end' as const,
            render: editButton,
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
                  {t('branches.new')}
                </Button>
              ),
            }
          : {})}
        notice={canWrite ? undefined : <Alert tone="info">{t('branches.readOnly')}</Alert>}
        rows={branches ?? []}
        rowKey={(branch) => branch.id}
        loading={branches === null && error === null}
        error={error}
        onRetry={reload}
        emptyTitle={t('branches.empty')}
        viewStorageKey="klinara.admin.view.branches"
        pagination={{ mode: 'client' }}
        renderTable={(rows) => (
          <DataTable
            caption={t('branches.title')}
            columns={columns}
            rows={rows}
            rowKey={(branch) => branch.id}
          />
        )}
        renderCard={(branch) => (
          <Card className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-body-emphasis">{branch.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{branch.slug}</p>
              </div>
              {status(branch)}
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              {branch.address === null ? null : (
                <span className="flex items-start gap-1.5">
                  <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span className="line-clamp-2">{branch.address}</span>
                </span>
              )}
              {branch.phone === null ? null : (
                <span className="flex items-center gap-1.5">
                  <Phone aria-hidden="true" className="size-3.5 shrink-0" />
                  {branch.phone}
                </span>
              )}
              <span>
                {t('branches.staffCount', { count: staffCount.get(branch.id) ?? 0 })} ·{' '}
                {branch.timezone}
              </span>
            </div>
            {canWrite ? (
              <div className="mt-auto flex justify-end border-t border-border pt-3">
                {editButton(branch)}
              </div>
            ) : null}
          </Card>
        )}
      />

      {canWrite ? (
        <BranchFormDialog
          open={creating || editing !== null}
          branch={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={saved}
        />
      ) : null}
    </>
  );
}
