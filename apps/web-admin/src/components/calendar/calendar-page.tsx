'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { PERMISSIONS, type Service, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useBranch } from '@/components/session/branch-provider';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  daysFrom,
  formatDayLabel,
  formatWeekLabel,
  todayKey,
  weekStart,
  type DayKey,
} from '@/lib/calendar/date';
import { CreateAppointmentDialog } from './appointment-form/create-dialog';
import { AgendaList } from './agenda-list';
import { AppointmentSheet } from './appointment-sheet';
import { CalendarToolbar } from './calendar-toolbar';
import { DayGrid } from './day-grid';
import { WeekGrid } from './week-grid';
import { shiftDay, useCalendar, type CalendarView } from './use-calendar';
import { useCalendarMode } from './use-calendar-mode';

/**
 * Takvim ekranı.
 *
 * Görünüm iki eksenli: GÜN/HAFTA (hangi aralık — veri isteğini belirliyor) ×
 * IZGARA/AJANDA (nasıl çiziliyor — yalnız sunum). İkinci eksen istek atmıyor;
 * aynı `CalendarResponse` iki biçimde çiziliyor. Mod seçimi ve varsayılanı
 * `use-calendar-mode.ts`te (telefonda ajanda).
 *
 * ---------------------------------------------------------------------------
 * KAPSAM ROZETİ SUNUCUDAN GELMİYOR — VE BU BİR BORÇ
 * ---------------------------------------------------------------------------
 * `calendar.service.ts` bir uygulayıcıyı `ownStaffProfileId` ile kendi
 * randevularına daraltıyor ama yanıtta bunu SÖYLEMİYOR: `CalendarResponse`ta
 * `scope` alanı yok. Dolayısıyla rozet burada İZİN LİSTESİNDEN çıkarılıyor.
 *
 * Bu, 10.1'in `ReportScopeKind` ile bilerek kaçındığı hatanın küçük bir
 * versiyonu: daraltma kuralı iki yerde ayrı ayrı yorumlanıyor ve sunucu
 * kuralı değiştirirse rozet yalan söyler. Doğru çözüm sunucuya `scope`
 * eklemek (planda A3, "önerilir"); o gelene kadar çıkarım burada ve
 * işaretli duruyor.
 */
export function CalendarPage(): ReactNode {
  const { permissions } = useSession();
  const { branches, setBranchId } = useBranch();
  const [view, setView] = useState<CalendarView>('day');
  const [mode, setMode] = useCalendarMode();
  const [day, setDay] = useState<DayKey>(() => todayKey('Europe/Istanbul'));
  const [staffProfileId, setStaffProfileId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);

  const state = useCalendar({ view, day, staffProfileId });
  const timezone = state.data?.timezone ?? 'Europe/Istanbul';

  // Bkz. dosya başlığı: sunucu `scope` döndürmediği için çıkarım.
  const ownOnly =
    !permissions.includes(PERMISSIONS.APPOINTMENT_READ_ALL) &&
    permissions.includes(PERMISSIONS.APPOINTMENT_READ_OWN);
  const canWrite = permissions.includes(PERMISSIONS.APPOINTMENT_WRITE);

  // Katalog ve personel BİR KEZ okunuyor: ikisi de sayfalanmıyor ve randevu
  // formu ile personel süzgeci ikisini de istiyor.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [serviceList, staffList] = await Promise.all([
          api.get<{ data: Service[] }>('services', { signal: controller.signal }),
          api.get<{ data: StaffProfile[] }>('staff', { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setServices(serviceList.data);
        setStaff(staffList.data);
      } catch {
        // Sessiz: bu iki liste yalnız formu ve süzgeci besliyor. Takvimin
        // kendisi onlarsız çalışıyor ve ekrana kırmızı bir satır basmak,
        // görünen veriyle çelişirdi.
      }
    })();
    return () => controller.abort();
  }, []);

  const staffNames = useMemo(
    () => new Map(staff.map((profile) => [profile.id, profile.userFullName])),
    [staff],
  );

  const anchor = view === 'week' ? weekStart(day) : day;
  const days = useMemo(() => (view === 'week' ? daysFrom(anchor, 7) : [anchor]), [view, anchor]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        title={t('calendar.title')}
        actions={
          canWrite && state.branchId !== null ? (
            <Button
              type="button"
              onClick={() => setCreating(true)}
              className="max-sm:h-9 max-sm:px-3 max-sm:text-sm"
            >
              <Plus aria-hidden="true" />
              {t('calendar.newAppointment')}
            </Button>
          ) : undefined
        }
      />

      {ownOnly ? <Alert tone="info">{t('calendar.scopeOwn')}</Alert> : null}

      <Card className="p-4 sm:p-5">
        <CalendarToolbar
          view={view}
          mode={mode}
          label={view === 'week' ? formatWeekLabel(anchor) : formatDayLabel(anchor)}
          branches={branches}
          branchId={state.branchId}
          onBranchChange={setBranchId}
          staff={staff}
          staffProfileId={staffProfileId}
          showStaffFilter={!ownOnly}
          onViewChange={setView}
          onModeChange={setMode}
          onPrev={() => setDay(shiftDay(day, view, -1))}
          onToday={() => setDay(todayKey(timezone))}
          onNext={() => setDay(shiftDay(day, view, 1))}
          onStaffChange={setStaffProfileId}
        />
      </Card>

      {state.needsBranch ? (
        <Card>
          <EmptyState title={t('calendar.title')} message={t('calendar.needsBranch')} />
        </Card>
      ) : null}

      {state.error !== null ? (
        <Alert tone="danger">
          <span role="alert">{state.error}</span>
        </Alert>
      ) : null}

      {state.pollStopped ? (
        <Alert tone="info">
          {t('calendar.liveStopped')}{' '}
          <button type="button" onClick={state.reload} className="underline">
            {t('calendar.refresh')}
          </button>
        </Alert>
      ) : null}

      {state.loading ? (
        <Card className="flex flex-col gap-2 p-3 sm:p-5" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </Card>
      ) : null}

      {/* İçerik zeminin bir ton açığında, kart üzerinde: ızgara ile sayfa
          arka planı aynı renkteyken ızgaranın nerede bitip sayfanın nerede
          başladığı okunmuyordu. */}
      {state.data !== null ? (
        <Card className={mode === 'agenda' ? 'p-3 sm:p-5' : 'p-2 sm:p-4'}>
          {mode === 'agenda' ? (
            <AgendaList
              days={days}
              entries={state.data.appointments}
              timezone={state.data.timezone}
              staffNames={staffNames}
              onSelect={(entry) => setSelected(entry.id)}
            />
          ) : view === 'day' ? (
            <DayGrid
              day={anchor}
              entries={state.data.appointments}
              timezone={state.data.timezone}
              onSelect={(entry) => setSelected(entry.id)}
            />
          ) : (
            <WeekGrid
              weekStart={anchor}
              entries={state.data.appointments}
              density={state.data.density}
              timezone={state.data.timezone}
              staffFiltered={staffProfileId !== null}
              onSelect={(entry) => setSelected(entry.id)}
              onPickDay={(picked) => {
                setDay(picked);
                setView('day');
              }}
            />
          )}
        </Card>
      ) : null}

      <AppointmentSheet
        appointmentId={selected}
        timezone={timezone}
        onClose={() => setSelected(null)}
        onChanged={state.reload}
      />

      {state.branchId !== null ? (
        <CreateAppointmentDialog
          open={creating}
          branchId={state.branchId}
          timezone={timezone}
          services={services}
          staff={staff}
          onClose={() => setCreating(false)}
          onCreated={state.reload}
        />
      ) : null}
    </div>
  );
}
