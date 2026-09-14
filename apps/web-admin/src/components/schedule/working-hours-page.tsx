'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  PERMISSIONS,
  type BranchHours,
  type StaffProfile,
  type StaffScheduleByBranch,
} from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { toMessage } from '@/lib/reports/errors';
import { fromEntries, toBranchHours, type DayDraft } from '@/lib/schedule/entries';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExceptionsPanel } from './exceptions-panel';
import { HolidaysPanel } from './holidays-panel';
import { StaffScheduleTab } from './staff-schedule-tab';
import { useUnsavedGuard } from './unsaved-guard';
import { useWeekDraft } from './use-week-draft';
import { WeekEditor } from './week-editor';

/**
 * Çalışma saatleri: şube saatleri, personel planı, izinler, tatiller.
 *
 * ---------------------------------------------------------------------------
 * TASLAKLAR SAYFADA TUTULUYOR
 * ---------------------------------------------------------------------------
 * Radix `TabsContent` pasif sekmeyi UNMOUNT ediyor. Taslaklar sekme
 * bileşenlerinde tutulsaydı "personel planına bir bakıp geri dönen" kullanıcı
 * şube saatlerindeki değişikliklerini kaybederdi. Bu yüzden iki haftalık
 * taslak ve personel planı yüklemesi burada; sekmeler yalnız görünüm.
 * Değişiklik bekleyen sekmenin başlığında bir nokta duruyor.
 *
 * Kaydedilmemiş değişiklik varken sayfadan çıkış ve başka personele geçiş
 * onay istiyor (`unsaved-guard.tsx`).
 *
 * ---------------------------------------------------------------------------
 * ŞUBE SAAT DİLİMİ
 * ---------------------------------------------------------------------------
 * İzin saatleri ŞUBENİN saat diliminde kuruluyor. Şube listesi henüz yoksa
 * (ya da testte boşsa) `Europe/Istanbul` — takvim sayfasıyla aynı varsayım.
 */

type TabValue = 'branch' | 'staff' | 'exceptions' | 'holidays';

const FALLBACK_TIMEZONE = 'Europe/Istanbul';

export function WorkingHoursPage(): ReactNode {
  const { permissions } = useSession();
  const { branchId, branches, canSelectAll } = useBranch();
  const canWrite = permissions.includes(PERMISSIONS.SCHEDULE_WRITE);
  const timeZone = branches.find((branch) => branch.id === branchId)?.timezone ?? FALLBACK_TIMEZONE;

  const [tab, setTab] = useState<TabValue>('branch');
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [staffProfileId, setStaffProfileId] = useState<string | null>(null);
  const [savedBranchDays, setSavedBranchDays] = useState<DayDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [savingBranch, setSavingBranch] = useState(false);
  const [nonce, setNonce] = useState(0);

  const branchWeek = useWeekDraft();
  const staffWeek = useWeekDraft();
  const { guard, dialog } = useUnsavedGuard(branchWeek.dirty || staffWeek.dirty);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const { load: loadBranch, clear: clearBranch } = branchWeek;
  const { load: loadStaff, clear: clearStaff } = staffWeek;

  // Şube ya da personel değişince eski taslak render sırasında atılıyor —
  // effect'te atmak bir kare boyunca eski şubenin saatlerini yeni şubenin
  // başlığı altında gösterirdi.
  const [branchKey, setBranchKey] = useState(branchId);
  if (branchKey !== branchId) {
    setBranchKey(branchId);
    clearBranch();
    setSavedBranchDays(null);
  }
  const staffKey = `${branchId ?? ''}|${staffProfileId ?? ''}`;
  const [loadedStaffKey, setLoadedStaffKey] = useState(staffKey);
  if (loadedStaffKey !== staffKey) {
    setLoadedStaffKey(staffKey);
    clearStaff();
    setStaffError(null);
  }

  // Şube saatleri + personel listesi.
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
        const days = fromEntries(hours.entries);
        loadBranch(days);
        setSavedBranchDays(days);
        setStaff(staffList.data.filter((profile) => profile.isActive));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [branchId, nonce, loadBranch]);

  // Seçili personelin planı — sekme unmount olsa da taslak kaybolmasın diye burada.
  useEffect(() => {
    if (branchId === null || staffProfileId === null) return;
    const controller = new AbortController();

    void (async () => {
      try {
        // ⚠️ Sorgu parametresi VE başlık — ikisi de gerekli.
        const schedule = await api.get<StaffScheduleByBranch>(
          `staff/${staffProfileId}/schedule?branchId=${branchId}`,
          { signal: controller.signal, branchId },
        );
        if (controller.signal.aborted) return;
        loadStaff(fromEntries(schedule.entries));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setStaffError(toMessage(caught));
      }
    })();
    return () => controller.abort();
  }, [branchId, staffProfileId, loadStaff]);

  async function saveBranchHours(): Promise<void> {
    if (branchId === null || branchWeek.issues.length > 0) return;
    setSavingBranch(true);
    setError(null);
    try {
      // TAM DEĞİŞTİRME: yedi günün tamamı gidiyor.
      await api.put(
        `branches/${branchId}/hours`,
        { entries: toBranchHours(branchWeek.draft) },
        { branchId },
      );
      branchWeek.load(branchWeek.draft);
      setSavedBranchDays(branchWeek.draft);
      toast.success(t('schedule.saved'));
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setSavingBranch(false);
    }
  }

  if (branchId === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('schedule.title')} className="mb-0" />
        <EmptyState title={t('schedule.title')} message={t('schedule.pickBranch')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('schedule.title')}
        description={t('schedule.description')}
        className="mb-0"
      />

      {!canWrite ? <Alert tone="info">{t('catalog.readOnly')}</Alert> : null}

      {error !== null ? (
        <Alert tone="danger">
          <span className="flex flex-wrap items-center justify-between gap-2">
            {error}
            <button
              type="button"
              className="font-semibold underline underline-offset-4"
              onClick={reload}
            >
              {t('common.retry')}
            </button>
          </span>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)} className="gap-5">
        {/* Telefonda dört sekme sığmıyor; liste kendi içinde yatay kayıyor. */}
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-10">
            <Trigger value="branch" dirty={branchWeek.dirty}>
              {t('schedule.branchHours')}
            </Trigger>
            <Trigger value="staff" dirty={staffWeek.dirty}>
              {t('schedule.staffSchedule')}
            </Trigger>
            <Trigger value="exceptions">{t('schedule.exceptions')}</Trigger>
            <Trigger value="holidays">{t('schedule.holidays')}</Trigger>
          </TabsList>
        </div>

        <TabsContent value="branch">
          {branchWeek.loaded ? (
            <WeekEditor
              mode="branch"
              week={branchWeek}
              canWrite={canWrite}
              saving={savingBranch}
              onSave={() => void saveBranchHours()}
            />
          ) : error === null ? (
            <EditorSkeleton />
          ) : null}
        </TabsContent>

        <TabsContent value="staff">
          <StaffScheduleTab
            branchId={branchId}
            staff={staff}
            staffProfileId={staffProfileId}
            onStaffChange={(next) => guard(() => setStaffProfileId(next))}
            week={staffWeek}
            branchDays={savedBranchDays}
            canWrite={canWrite}
            loadError={staffError}
          />
        </TabsContent>

        <TabsContent value="exceptions">
          <ExceptionsPanel
            branchId={branchId}
            timeZone={timeZone}
            staff={staff}
            canWrite={canWrite}
          />
        </TabsContent>

        <TabsContent value="holidays">
          <HolidaysPanel
            branchId={branchId}
            timeZone={timeZone}
            canWrite={canWrite}
            canWriteTenant={canSelectAll}
          />
        </TabsContent>
      </Tabs>

      {dialog}
    </div>
  );
}

function Trigger({
  value,
  dirty = false,
  children,
}: {
  value: TabValue;
  dirty?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <TabsTrigger value={value} className="gap-1.5 px-3">
      {children}
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full bg-primary transition-opacity', dirty ? 'opacity-100' : 'opacity-0')}
      />
      {dirty ? <span className="sr-only">{t('schedule.tabUnsaved')}</span> : null}
    </TabsTrigger>
  );
}

function EditorSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-56 w-full rounded-xl" />
      {[0, 1, 2, 3].map((key) => (
        <Skeleton key={key} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
