'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { toMessage } from '@/lib/reports/errors';
import {
  outsideBranchHours,
  staffWeekFromBranch,
  toStaffSchedule,
  type DayDraft,
} from '@/lib/schedule/entries';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldSelect } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import type { WeekDraft } from './use-week-draft';
import { WeekEditor } from './week-editor';

/**
 * Personelin şubedeki haftalık planı.
 *
 * ---------------------------------------------------------------------------
 * ÜÇ YERDE ŞUBE
 * ---------------------------------------------------------------------------
 * `staff/:id/schedule` şubeyi ÜÇ ayrı yerden istiyor: `GET`te sorgu
 * parametresi, `PUT`ta gövde alanı, ve her ikisinde `X-Branch-Id` başlığı
 * (`@RequireBranchScope()`). Üçü de gönderiliyor — eksik biri ya 400 ya da
 * sessizce YANLIŞ ŞUBEYE yazma riski.
 *
 * Başka bir personele geçmek taslağı atıyor; bu yüzden seçim değişimi
 * sayfanın kaydedilmemiş değişiklik korumasından geçiyor (`onStaffChange`).
 */
export function StaffScheduleTab({
  branchId,
  staff,
  staffLoading = false,
  staffProfileId,
  onStaffChange,
  week,
  branchDays,
  canWrite,
  loadError,
}: {
  branchId: string;
  staff: readonly StaffProfile[];
  /** Şubenin personel listesi henüz gelmedi — "personel yok" demek erken. */
  staffLoading?: boolean;
  staffProfileId: string | null;
  onStaffChange: (staffProfileId: string | null) => void;
  week: WeekDraft;
  /** KAYITLI şube saatleri — kıyas ve "şube saatlerini uygula" için. */
  branchDays: readonly DayDraft[] | null;
  canWrite: boolean;
  /** Plan yüklemesi sayfada — sekme unmount olunca taslak kaybolmasın. */
  loadError: string | null;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shownError = error ?? loadError;

  const warnings = useMemo(
    () => (branchDays === null ? [] : outsideBranchHours(week.draft, branchDays)),
    [week.draft, branchDays],
  );

  async function save(): Promise<void> {
    if (staffProfileId === null || week.issues.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      // Şube ÜÇ yerde: gövde, başlık ve (GET'te) sorgu.
      await api.put(
        `staff/${staffProfileId}/schedule`,
        { branchId, entries: toStaffSchedule(week.draft) },
        { branchId },
      );
      week.load(week.draft);
      toast.success(t('schedule.saved'));
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <FieldSelect
          label={t('schedule.pickStaff')}
          className="w-full sm:max-w-sm"
          value={staffProfileId ?? ''}
          disabled={staff.length === 0 || saving}
          onChange={(event) => onStaffChange(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">—</option>
          {staff.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.userFullName}
              {profile.title === null ? '' : ` · ${profile.title}`}
            </option>
          ))}
        </FieldSelect>
      </div>

      {shownError !== null ? <Alert tone="danger">{shownError}</Alert> : null}

      {staffLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : staff.length === 0 ? (
        <EmptyState
          title={t('schedule.noStaff')}
          message={t('schedule.noStaffHint')}
          footer={
            <Link href="/personel" className="text-sm font-semibold text-primary underline underline-offset-4">
              {t('schedule.goToStaff')}
            </Link>
          }
        />
      ) : staffProfileId === null ? (
        <EmptyState title={t('schedule.pickStaff')} message={t('schedule.pickStaffHint')} />
      ) : !week.loaded ? (
        shownError === null ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : null
      ) : (
        <>
          {warnings.length > 0 ? (
            <Alert tone="warn" title={t('schedule.outsideBranchTitle')}>
              {t('schedule.outsideBranchBody')}
            </Alert>
          ) : null}
          <WeekEditor
            mode="staff"
            week={week}
            canWrite={canWrite}
            saving={saving}
            reference={branchDays ?? undefined}
            warnings={warnings}
            toolbar={
              canWrite && branchDays !== null ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => week.setDraft(staffWeekFromBranch(branchDays))}
                >
                  {t('schedule.applyBranchHours')}
                </Button>
              ) : undefined
            }
            onSave={() => void save()}
          />
        </>
      )}
    </div>
  );
}
