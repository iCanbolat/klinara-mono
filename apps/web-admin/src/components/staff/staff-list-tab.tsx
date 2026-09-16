'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  PERMISSIONS,
  type AdminUser,
  type Branch,
  type Membership,
  type Service,
  type StaffProfile,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { roleName } from '@/lib/staff/memberships';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import {
  matchesStatus,
  StatusSelect,
  type StatusFilter,
} from '@/components/data-page/status-filter';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldSelect } from '@/components/ui/field';
import { InviteDialog } from './invite-dialog';
import { CompetencyMatrix } from './competency-matrix';
import { StaffCard } from './staff-card';
import { StaffEditSheet } from './staff-edit-sheet';

/**
 * Personel sekmesi.
 *
 * ---------------------------------------------------------------------------
 * ŞUBE SÜZGECİ SUNUCUDA
 * ---------------------------------------------------------------------------
 * `GET staff?branchId=` o şubeye AİT personeli döner: ana şubesi o şube olan
 * VEYA o şubede aktif rolü olan. Aynı kural Çalışma Saatleri'nde ve mobilde
 * kullanılıyor; istemcide yeniden yazmak `user:read` taşımayan rollerde
 * (uygulayıcı) üyelikleri göremediği için YANLIŞ bir liste verirdi.
 *
 * "Tüm şubeler" yalnız kiracı geneli rollerde seçilebiliyor — şube yöneticisi
 * erişemediği şubenin listesini zaten 403 ile alamaz.
 *
 * ---------------------------------------------------------------------------
 * ROLLER `GET users`TAN
 * ---------------------------------------------------------------------------
 * Personel yanıtı rol taşımıyor; `user:read` varsa kullanıcı listesiyle
 * birleştiriliyor. İzin yoksa rol kolonu hiç çizilmiyor ("rolü yok" demek
 * yanlış olurdu).
 */
export function StaffListTab(): ReactNode {
  const { permissions } = useSession();
  const { branches, branchId: activeBranchId, canSelectAll } = useBranch();

  const canWrite = permissions.includes(PERMISSIONS.STAFF_WRITE);
  const canReadUsers = permissions.includes(PERMISSIONS.USER_READ);
  const canInvite = permissions.includes(PERMISSIONS.USER_INVITE);
  const canEdit = canWrite || canReadUsers;

  const [staff, setStaff] = useState<StaffProfile[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [users, setUsers] = useState<Map<string, AdminUser>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const [competencyFor, setCompetencyFor] = useState<StaffProfile | null>(null);
  const [editing, setEditing] = useState<StaffProfile | null>(null);
  const [inviting, setInviting] = useState(false);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  // `''` = tüm şubeler. İlk değer global seçili şube; sonra sekmeye özel.
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const effectiveBranch =
    branchFilter ?? activeBranchId ?? (canSelectAll ? '' : (branches[0]?.id ?? ''));

  useEffect(() => {
    // Kiracı geneli olmayan rolde şube listesi henüz yoksa istek atılmıyor:
    // süzgeçsiz istek, erişemediği şubelerin personelini de getirirdi.
    if (effectiveBranch === '' && !canSelectAll) return;
    const controller = new AbortController();
    void (async () => {
      setError(null);
      setStaff(null);
      try {
        const path =
          effectiveBranch === ''
            ? 'staff'
            : `staff?branchId=${encodeURIComponent(effectiveBranch)}`;
        const [staffList, serviceList, userList] = await Promise.all([
          api.get<{ data: StaffProfile[] }>(path, { signal: controller.signal }),
          api.get<{ data: Service[] }>('services', { signal: controller.signal }),
          canReadUsers
            ? api.get<{ data: AdminUser[] }>('users', { signal: controller.signal })
            : Promise.resolve({ data: [] as AdminUser[] }),
        ]);
        if (controller.signal.aborted) return;
        setStaff(staffList.data);
        setServices(serviceList.data);
        setUsers(new Map(userList.data.map((user) => [user.id, user])));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [effectiveBranch, canSelectAll, canReadUsers, nonce]);

  async function saveCompetencies(profile: StaffProfile, serviceIds: string[]): Promise<void> {
    setError(null);
    try {
      // ⚠️ TAM DEĞİŞTİRME: gönderilmeyen hizmet personelden silinir.
      await api.put(`staff/${profile.id}/services`, {
        services: serviceIds.map((serviceId) => ({ serviceId })),
      });
      toast.success(t('staff.saved'));
      setCompetencyFor(null);
      reload();
    } catch (caught) {
      setError(toMessage(caught));
    }
  }

  const branchName = useCallback(
    (id: string | null): string =>
      id === null
        ? t('staff.tenantWide')
        : (branches.find((branch) => branch.id === id)?.name ?? t('staff.inaccessibleBranch')),
    [branches],
  );

  const serviceNames = (profile: StaffProfile): string =>
    profile.services
      .filter((link) => link.isActive)
      .map((link) => services.find((service) => service.id === link.serviceId)?.name)
      .filter((name): name is string => name !== undefined)
      .join(', ') || '—';

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    return (staff ?? []).filter(
      (profile) =>
        (needle === '' ||
          profile.userFullName.toLocaleLowerCase('tr').includes(needle) ||
          profile.userEmail.toLocaleLowerCase('tr').includes(needle)) &&
        matchesStatus(status, profile.isActive),
    );
  }, [staff, query, status]);

  const isFiltered = query.trim() !== '' || status !== 'all';

  const membershipsOf = (profile: StaffProfile): Membership[] =>
    users.get(profile.userId)?.memberships ?? [];

  const actions = (profile: StaffProfile): ReactNode => (
    <>
      {canEdit ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(profile)}>
          {t('staff.edit')}
        </Button>
      ) : null}
      {canWrite ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setCompetencyFor(profile)}>
          {t('staff.competency')}
        </Button>
      ) : null}
    </>
  );

  const columns: DataColumn<StaffProfile>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      render: (profile) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-body-emphasis">
            {profile.userFullName}
            {!profile.isActive ? (
              <span className="ml-2 text-xs text-muted-foreground">{t('list.inactive')}</span>
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {profile.title ?? '—'} · {profile.userEmail}
          </span>
        </div>
      ),
    },
    ...(canReadUsers
      ? [
          {
            key: 'roles',
            header: t('staff.roles'),
            render: (profile: StaffProfile) => (
              <RoleBadges memberships={membershipsOf(profile)} branchName={branchName} />
            ),
          },
        ]
      : []),
    {
      key: 'primaryBranch',
      header: t('staff.branch'),
      render: (profile) =>
        profile.primaryBranchId === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          branchName(profile.primaryBranchId)
        ),
    },
    {
      key: 'services',
      header: t('staff.services'),
      className: 'max-w-72 text-muted-foreground',
      render: (profile) => <span className="line-clamp-2">{serviceNames(profile)}</span>,
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('list.actions')}</span>,
            align: 'end' as const,
            render: (profile: StaffProfile) => (
              <div className="flex justify-end gap-1">{actions(profile)}</div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <DataPage
        {...(canInvite
          ? {
              actions: (
                <Button type="button" onClick={() => setInviting(true)}>
                  {t('invites.new')}
                </Button>
              ),
            }
          : {})}
        notice={canEdit ? undefined : <Alert tone="info">{t('catalog.readOnly')}</Alert>}
        filters={
          <>
            <Field
              label={t('staff.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <FieldSelect
              label={t('staff.branchFilter')}
              value={effectiveBranch}
              onChange={(event) => setBranchFilter(event.target.value)}
            >
              {canSelectAll ? <option value="">{t('staff.allBranches')}</option> : null}
              {branches.map((branch: Branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                  {branch.isActive === false
                    ? ` (${t('branches.inactive').toLocaleLowerCase('tr')})`
                    : ''}
                </option>
              ))}
            </FieldSelect>
            <StatusSelect value={status} onChange={setStatus} />
          </>
        }
        rows={filtered}
        rowKey={(profile) => profile.id}
        loading={staff === null && error === null}
        error={error}
        onRetry={reload}
        emptyTitle={isFiltered ? t('list.filteredEmpty') : t('staff.empty')}
        {...(!isFiltered && effectiveBranch !== ''
          ? { emptyMessage: t('schedule.noStaffHint') }
          : {})}
        viewStorageKey="klinara.admin.view.staff"
        pagination={{ mode: 'client' }}
        resetKey={`${query}|${status}|${effectiveBranch}`}
        renderTable={(rows) => (
          <DataTable
            caption={t('staff.title')}
            columns={columns}
            rows={rows}
            rowKey={(profile) => profile.id}
          />
        )}
        renderCard={(profile) => (
          <StaffCard
            profile={profile}
            serviceNames={serviceNames(profile)}
            {...(canReadUsers
              ? {
                  roles: (
                    <RoleBadges memberships={membershipsOf(profile)} branchName={branchName} />
                  ),
                }
              : {})}
            {...(canEdit ? { actions: actions(profile) } : {})}
          />
        )}
      />

      {canWrite ? (
        <Dialog
          open={competencyFor !== null}
          onOpenChange={(next) => !next && setCompetencyFor(null)}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            {competencyFor === null ? null : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('staff.competency')}</DialogTitle>
                  <DialogDescription>{competencyFor.userFullName}</DialogDescription>
                </DialogHeader>
                <CompetencyMatrix
                  // Başka bir personel açılınca seçim sıfırdan okunmalı.
                  key={competencyFor.id}
                  className="mt-0 border-0 p-0"
                  profile={competencyFor}
                  services={services}
                  onCancel={() => setCompetencyFor(null)}
                  onSave={(serviceIds) => void saveCompetencies(competencyFor, serviceIds)}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      ) : null}

      {canEdit ? (
        <StaffEditSheet profile={editing} onClose={() => setEditing(null)} onSaved={reload} />
      ) : null}

      {canInvite ? (
        <InviteDialog
          open={inviting}
          onClose={() => setInviting(false)}
          onSent={() => setInviting(false)}
        />
      ) : null}
    </>
  );
}

export function RoleBadges({
  memberships,
  branchName,
}: {
  memberships: readonly Membership[];
  branchName: (id: string | null) => string;
}): ReactNode {
  if (memberships.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {memberships.map((membership) => (
        <li key={membership.id}>
          <Badge variant="outline" className="font-normal">
            <span className="font-medium">{roleName(membership.roleKey)}</span>
            <span className="text-muted-foreground">· {branchName(membership.branchId)}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
