'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type Service, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { CompetencyMatrix } from './competency-matrix';

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
 * geliyor ve istemcide süzülüyor. Birkaç yüz personele kadar sorun değil;
 * ötesi API işi (plan A5).
 */
export function StaffPage(): ReactNode {
  const { permissions } = useSession();
  const [staff, setStaff] = useState<StaffProfile[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffProfile | null>(null);
  const [nonce, setNonce] = useState(0);

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('staff.title')} />

      {!canWrite ? <Alert tone="info">{t('catalog.readOnly')}</Alert> : null}
      {canWrite ? <Alert tone="info">{t('staff.roleReadOnly')}</Alert> : null}

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      {staff === null && error === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {staff !== null && staff.length === 0 ? <EmptyState title={t('staff.empty')} /> : null}

      <ul className="flex flex-col gap-3">
        {(staff ?? []).map((profile) => (
          <li key={profile.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-body-emphasis">{profile.userFullName}</p>
                <p className="text-xs text-muted-foreground">
                  {profile.title ?? '—'} · {profile.userEmail}
                  {!profile.isActive ? ' · pasif' : ''}
                </p>
              </div>
              {canWrite ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(editing?.id === profile.id ? null : profile)}
                >
                  {t('staff.competency')}
                </Button>
              ) : null}
            </div>

            {editing?.id === profile.id ? (
              <CompetencyMatrix
                profile={profile}
                services={services}
                onCancel={() => setEditing(null)}
                onSave={(serviceIds) => void saveCompetencies(profile, serviceIds)}
              />
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {profile.services
                  .filter((link) => link.isActive)
                  .map((link) => services.find((service) => service.id === link.serviceId)?.name)
                  .filter((name): name is string => name !== undefined)
                  .join(', ') || '—'}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
