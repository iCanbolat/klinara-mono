'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS, type Service, type StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { api } from '@/lib/api/client';
import { useSession } from '@/components/session/session-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldSelect } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatDayLabel,
  formatWeekLabel,
  todayKey,
  weekStart,
  type DayKey,
} from '@/lib/calendar/date';
import { CreateAppointmentDialog } from './appointment-form/create-dialog';
import { AppointmentSheet } from './appointment-sheet';
import { DayGrid } from './day-grid';
import { WeekGrid } from './week-grid';
import { shiftDay, useCalendar, type CalendarView } from './use-calendar';

/**
 * Takvim ekranı.
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
  const [view, setView] = useState<CalendarView>('day');
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

  const anchor = view === 'week' ? weekStart(day) : day;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('calendar.title')}
        actions={
          canWrite && state.branchId !== null ? (
            <Button type="button" onClick={() => setCreating(true)}>
              {t('calendar.newAppointment')}
            </Button>
          ) : undefined
        }
      />

      {ownOnly ? <Alert tone="info">{t('calendar.scopeOwn')}</Alert> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1" role="group" aria-label={t('calendar.title')}>
          <Button
            type="button"
            variant={view === 'day' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={view === 'day'}
            onClick={() => setView('day')}
          >
            {t('calendar.day')}
          </Button>
          <Button
            type="button"
            variant={view === 'week' ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            {t('calendar.week')}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setDay(shiftDay(day, view, -1))}>
            {t('calendar.prev')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDay(todayKey(timezone))}>
            {t('calendar.today')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDay(shiftDay(day, view, 1))}>
            {t('calendar.next')}
          </Button>
        </div>

        <span className="text-body-emphasis">
          {view === 'week' ? formatWeekLabel(anchor) : formatDayLabel(anchor)}
        </span>

        {/* Uygulayıcı zaten sunucuda kendi randevularına daraltılmış;
            ona bir personel süzgeci göstermek anlamsız bir kontrol olurdu. */}
        {!ownOnly ? (
          <FieldSelect
            label={t('calendar.allStaff')}
            className="w-48"
            value={staffProfileId ?? ''}
            onChange={(event) =>
              setStaffProfileId(event.target.value === '' ? null : event.target.value)
            }
          >
            <option value="">{t('calendar.allStaff')}</option>
            {staff
              .filter((profile) => profile.isActive)
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.userFullName}
                </option>
              ))}
          </FieldSelect>
        ) : null}
      </div>

      {state.needsBranch ? (
        <EmptyState title={t('calendar.title')} message="Devam etmek için bir şube seçin." />
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
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {state.data !== null ? (
        view === 'day' ? (
          <DayGrid
            entries={state.data.appointments}
            timezone={state.data.timezone}
            onSelect={(entry) => setSelected(entry.id)}
          />
        ) : (
          <WeekGrid
            weekStart={anchor}
            density={state.data.density}
            onPickDay={(picked) => {
              setDay(picked);
              setView('day');
            }}
          />
        )
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
