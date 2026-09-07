'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PERMISSIONS, type BranchHours, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldSelect } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  emptyWeek,
  fromEntries,
  toBranchHours,
  toStaffSchedule,
  validateWeek,
  type DayDraft,
} from '@/lib/schedule/entries';
import { WeekGridEditor } from './week-grid-editor';
import { ExceptionsPanel } from './exceptions-panel';

/**
 * Çalışma saatleri.
 *
 * ---------------------------------------------------------------------------
 * ÜÇ YERDE ŞUBE
 * ---------------------------------------------------------------------------
 * `PUT /staff/:id/schedule` şubeyi ÜÇ ayrı yerden istiyor: `GET`te sorgu
 * parametresi, `PUT`ta gövde alanı, ve her ikisinde `X-Branch-Id` başlığı
 * (`@RequireBranchScope()`). Üçü de gönderiliyor — eksik biri ya 400 ya da
 * sessizce YANLIŞ ŞUBEYE yazma riski.
 *
 * ---------------------------------------------------------------------------
 * TATİLLER PANELDEN YÖNETİLEMİYOR
 * ---------------------------------------------------------------------------
 * `holidays` tablosu var, seed'i var ve uygunluk motoru onu okuyor — ama
 * HTTP ucu YOK (plan A4). Ekran bir tatil sekmesi gösterip boş bırakmıyor;
 * durumu bir satırla söylüyor. Boş bir sekme "tatil tanımlı değil" derdi ve
 * bu yanlış olurdu.
 */
export function WorkingHoursPage(): ReactNode {
  const { permissions } = useSession();
  const { branchId } = useBranch();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [staffProfileId, setStaffProfileId] = useState<string | null>(null);

  const [branchDays, setBranchDays] = useState<DayDraft[]>(() => emptyWeek());
  const [staffDays, setStaffDays] = useState<DayDraft[]>(() => emptyWeek());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const canWrite = permissions.includes(PERMISSIONS.SCHEDULE_WRITE);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (branchId === null) return;
    const controller = new AbortController();

    void (async () => {
      setError(null);
      try {
        const [hours, staffList] = await Promise.all([
          api.get<BranchHours>(`branches/${branchId}/hours`, {
            signal: controller.signal,
            branchId,
          }),
          api.get<{ data: StaffProfile[] }>('staff', { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setBranchDays(fromEntries(hours.entries));
        setStaff(staffList.data.filter((profile) => profile.isActive));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [branchId, nonce]);

  useEffect(() => {
    if (branchId === null || staffProfileId === null) return;
    const controller = new AbortController();

    void (async () => {
      setError(null);
      try {
        // ⚠️ Sorgu parametresi VE başlık — ikisi de gerekli.
        const schedule = await api.get<{ entries: unknown[] }>(
          `staff/${staffProfileId}/schedule?branchId=${branchId}`,
          { signal: controller.signal, branchId },
        );
        if (controller.signal.aborted) return;
        setStaffDays(fromEntries(schedule.entries as Parameters<typeof fromEntries>[0]));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [branchId, staffProfileId, nonce]);

  async function saveBranchHours(): Promise<void> {
    if (branchId === null) return;
    const issues = validateWeek(branchDays);
    if (issues.length > 0) return;

    setBusy('branch');
    setError(null);
    try {
      // TAM DEĞİŞTİRME: yedi günün tamamı gidiyor.
      await api.put(`branches/${branchId}/hours`, { entries: toBranchHours(branchDays) }, { branchId });
      toast.success(t('schedule.saved'));
      reload();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveStaffSchedule(): Promise<void> {
    if (branchId === null || staffProfileId === null) return;
    const issues = validateWeek(staffDays);
    if (issues.length > 0) return;

    setBusy('staff');
    setError(null);
    try {
      // Şube ÜÇ yerde: gövde, başlık ve (GET'te) sorgu.
      await api.put(
        `staff/${staffProfileId}/schedule`,
        { branchId, entries: toStaffSchedule(staffDays) },
        { branchId },
      );
      toast.success(t('schedule.saved'));
      reload();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  if (branchId === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('schedule.title')} />
        <EmptyState title={t('schedule.title')} message="Devam etmek için bir şube seçin." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('schedule.title')} />

      {!canWrite ? <Alert tone="info">{t('catalog.readOnly')}</Alert> : null}
      {/* Tatiller panelden yönetilemiyor — boş sekme yerine açık ifade. */}
      <Alert tone="info">{t('schedule.holidaysMissing')}</Alert>

      {error !== null ? (
        <Alert tone="danger">
          <span role="alert">{error}</span>
        </Alert>
      ) : null}

      <Tabs defaultValue="branch">
        <TabsList>
          <TabsTrigger value="branch">{t('schedule.branchHours')}</TabsTrigger>
          <TabsTrigger value="staff">{t('schedule.staffSchedule')}</TabsTrigger>
          <TabsTrigger value="exceptions">{t('schedule.exceptions')}</TabsTrigger>
        </TabsList>

        <TabsContent value="branch">
          <WeekGridEditor
            days={branchDays}
            withBreak
            disabled={!canWrite || busy !== null}
            onChange={setBranchDays}
          />
          {canWrite ? (
            <Button
              type="button"
              className="mt-3"
              loading={busy === 'branch'}
              disabled={busy !== null || validateWeek(branchDays).length > 0}
              onClick={() => void saveBranchHours()}
            >
              {t('schedule.save')}
            </Button>
          ) : null}
        </TabsContent>

        <TabsContent value="staff">
          <FieldSelect
            label={t('schedule.pickStaff')}
            className="mb-3 max-w-sm"
            value={staffProfileId ?? ''}
            onChange={(event) =>
              setStaffProfileId(event.target.value === '' ? null : event.target.value)
            }
          >
            <option value="">—</option>
            {staff.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.userFullName}
              </option>
            ))}
          </FieldSelect>

          {staffProfileId !== null ? (
            <>
              <WeekGridEditor
                days={staffDays}
                withBreak={false}
                disabled={!canWrite || busy !== null}
                onChange={setStaffDays}
              />
              {canWrite ? (
                <Button
                  type="button"
                  className="mt-3"
                  loading={busy === 'staff'}
                  disabled={busy !== null || validateWeek(staffDays).length > 0}
                  onClick={() => void saveStaffSchedule()}
                >
                  {t('schedule.save')}
                </Button>
              ) : null}
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="exceptions">
          <ExceptionsPanel branchId={branchId} staff={staff} canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
