'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, List } from 'lucide-react';
import type { Branch, StaffProfile } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';
import { SegmentButton, Segmented } from '@/components/ui/segmented';
import type { CalendarMode } from './use-calendar-mode';
import type { CalendarView } from './use-calendar';

/**
 * Takvim araç çubuğu — iki satır, mobil öncelikli.
 *
 * Eski tek satırlık `flex-wrap` telefonda düğmeleri rastgele yerlerden
 * kırıyordu: tarih etiketi bir satırda, "Sonraki" bir diğerinde kalıyordu.
 * Şimdi 1. satır "neredeyim" (tarih + gezinme), 2. satır "nasıl bakıyorum"
 * (görünüm, mod, süzgeç); dar ekranda ikinci satırın ögeleri alt alta iniyor.
 *
 * ŞUBE SEÇİCİ BURADA: takvim uçları `@RequireBranchScope()` taşıyor ve "tüm
 * şubeler" diye bir takvim yok. Kiracı geneli bir rolün şube tercihi `null`
 * (raporlardaki "Tüm şubeler") iken takvim yalnız "bir şube seçin" diyordu —
 * ama seçimin yapılabileceği tek yer rapor süzgeciydi. Seçim `useBranch`
 * üzerinden paylaşıldığı için buradan yapılan seçim diğer ekranlara da geçer.
 */

export interface CalendarToolbarProps {
  view: CalendarView;
  mode: CalendarMode;
  label: string;
  branches: readonly Branch[];
  branchId: string | null;
  onBranchChange: (branchId: string) => void;
  staff: readonly StaffProfile[];
  staffProfileId: string | null;
  showStaffFilter: boolean;
  onViewChange: (view: CalendarView) => void;
  onModeChange: (mode: CalendarMode) => void;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onStaffChange: (staffProfileId: string | null) => void;
}

export function CalendarToolbar({
  view,
  mode,
  label,
  branches,
  branchId,
  onBranchChange,
  staff,
  staffProfileId,
  showStaffFilter,
  onViewChange,
  onModeChange,
  onPrev,
  onToday,
  onNext,
  onStaffChange,
}: CalendarToolbarProps): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-title-m" aria-live="polite">
          {label}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={t('calendar.prev')}
            onClick={onPrev}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onToday}>
            {t('calendar.today')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label={t('calendar.next')}
            onClick={onNext}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex gap-2">
          <Segmented label={t('calendar.title')}>
            <SegmentButton pressed={view === 'day'} onClick={() => onViewChange('day')}>
              {t('calendar.day')}
            </SegmentButton>
            <SegmentButton pressed={view === 'week'} onClick={() => onViewChange('week')}>
              {t('calendar.week')}
            </SegmentButton>
          </Segmented>

          <Segmented label={t('calendar.viewMode')}>
            <SegmentButton pressed={mode === 'grid'} onClick={() => onModeChange('grid')}>
              <LayoutGrid aria-hidden="true" />
              {t('calendar.grid')}
            </SegmentButton>
            <SegmentButton pressed={mode === 'agenda'} onClick={() => onModeChange('agenda')}>
              <List aria-hidden="true" />
              {t('calendar.agenda')}
            </SegmentButton>
          </Segmented>
        </div>

        {/* Uygulayıcı zaten sunucuda kendi randevularına daraltılmış;
            ona bir personel süzgeci göstermek anlamsız bir kontrol olurdu. */}
        <div className="flex w-full flex-col gap-3 sm:ml-auto sm:w-auto sm:flex-row">
          {branches.length > 1 || branchId === null ? (
            <div className="w-full sm:w-56">
              <FieldSelect
                label={t('shell.branch')}
                value={branchId ?? ''}
                onChange={(event) => {
                  if (event.target.value !== '') onBranchChange(event.target.value);
                }}
              >
                {branchId === null ? (
                  <option value="" disabled>
                    {t('calendar.pickBranch')}
                  </option>
                ) : null}
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </FieldSelect>
            </div>
          ) : null}
          {showStaffFilter ? (
            <div className="w-full sm:w-56">
              <FieldSelect
                label={t('calendar.allStaff')}
                value={staffProfileId ?? ''}
                onChange={(event) =>
                  onStaffChange(event.target.value === '' ? null : event.target.value)
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
