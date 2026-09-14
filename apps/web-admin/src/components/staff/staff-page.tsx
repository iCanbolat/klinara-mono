'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Service, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { DataPage } from '@/components/data-page/data-page';
import { DataTable, type DataColumn } from '@/components/data-page/data-table';
import { matchesStatus, StatusSelect, type StatusFilter } from '@/components/data-page/status-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { CompetencyMatrix } from './competency-matrix';
import { StaffCard } from './staff-card';

/**
 * Personel yönetimi.
 *
 * ---------------------------------------------------------------------------
 * ROL SALT OKUNUR — VE BU SUNUCUNUN EKSİĞİ
 * ---------------------------------------------------------------------------
 * API'de ÜYELİK/ROL DEĞİŞTİREN BİR UÇ YOK. `PATCH /users/:id` yalnız
 * `fullName`, `locale` ve `isActive` kabul ediyor; rol yalnız DAVETLE
 * atanıyor. Yani bir kullanıcının rolünü değiştirmenin tek yolu onu pasife
 * alıp yeniden davet etmek.
 *
 * Arayüz bunu gizlemiyor: rol alanı gösteriliyor ama düzenlenemiyor ve
 * sebebi yazılı. Sahte bir rol seçici koyup arkada davet göndermek,
 * kullanıcıya olmayan bir yetenek vaat etmek olurdu (plan A6).
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `GET /staff` SÜZGEÇ ALMIYOR
 * ---------------------------------------------------------------------------
 * Şube ya da aktiflik süzgeci yok, sayfalama da yok: tüm liste tek istekte
 * geliyor ve istemcide süzülüp sayfalanıyor. Birkaç yüz personele kadar sorun
 * değil; ötesi API işi (plan A5).
 *
 * Yetkinlik matrisi bir Dialog'da açılıyor: tablo satırının içinde
 * genişleyen bir form tablo görünümünde kolonları bozuyordu.
 */
export function StaffPage(): ReactNode {
  const { permissions } = useSession();
  const [staff, setStaff] = useState<StaffProfile[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffProfile | null>(null);
  const [nonce, setNonce] = useState(0);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const canWrite = permissions.includes(PERMISSIONS.STAFF_WRITE);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setError(null);
      try {
        const [staffList, serviceList] = await Promise.all([
          api.get<{ data: StaffProfile[] }>('staff', { signal: controller.signal }),
          api.get<{ data: Service[] }>('services', { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setStaff(staffList.data);
        setServices(serviceList.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [nonce]);

  async function saveCompetencies(profile: StaffProfile, serviceIds: string[]): Promise<void> {
    setError(null);
    try {
      // ⚠️ TAM DEĞİŞTİRME: gönderilmeyen hizmet personelden silinir.
      await api.put(`staff/${profile.id}/services`, {
        services: serviceIds.map((serviceId) => ({ serviceId })),
      });
      toast.success(t('staff.saved'));
      setEditing(null);
      reload();
    } catch (caught) {
      setError(toMessage(caught));
    }
  }

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

  const competencyButton = (profile: StaffProfile): ReactNode => (
    <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(profile)}>
      {t('staff.competency')}
    </Button>
  );

  const columns: DataColumn<StaffProfile>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      render: (profile) => (
        <>
          <span className="text-body-emphasis">{profile.userFullName}</span>
          {!profile.isActive ? (
            <span className="ml-2 text-xs text-muted-foreground">{t('list.inactive')}</span>
          ) : null}
        </>
      ),
    },
    { key: 'title', header: t('staff.jobTitle'), render: (profile) => profile.title ?? '—' },
    { key: 'email', header: t('staff.email'), render: (profile) => profile.userEmail },
    {
      key: 'services',
      header: t('staff.services'),
      className: 'max-w-80 text-muted-foreground',
      render: (profile) => <span className="line-clamp-2">{serviceNames(profile)}</span>,
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('list.actions')}</span>,
            align: 'end' as const,
            render: competencyButton,
          },
        ]
      : []),
  ];

  return (
    <>
      <DataPage
        title={t('staff.title')}
        notice={
          <Alert tone="info">{canWrite ? t('staff.roleReadOnly') : t('catalog.readOnly')}</Alert>
        }
        filters={
          <>
            <Field
              label={t('staff.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <StatusSelect value={status} onChange={setStatus} />
          </>
        }
        rows={filtered}
        rowKey={(profile) => profile.id}
        loading={staff === null && error === null}
        error={error}
        onRetry={reload}
        emptyTitle={isFiltered ? t('list.filteredEmpty') : t('staff.empty')}
        viewStorageKey="klinara.admin.view.staff"
        pagination={{ mode: 'client' }}
        resetKey={`${query}|${status}`}
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
            {...(canWrite ? { actions: competencyButton(profile) } : {})}
          />
        )}
      />

      {canWrite ? (
        <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            {editing === null ? null : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('staff.competency')}</DialogTitle>
                  <DialogDescription>{editing.userFullName}</DialogDescription>
                </DialogHeader>
                <CompetencyMatrix
                  // Başka bir personel açılınca seçim sıfırdan okunmalı.
                  key={editing.id}
                  className="mt-0 border-0 p-0"
                  profile={editing}
                  services={services}
                  onCancel={() => setEditing(null)}
                  onSave={(serviceIds) => void saveCompetencies(editing, serviceIds)}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
