'use client';

import type { ReactNode } from 'react';
import { useBranch } from '@/components/session/branch-provider';
import { t } from '@/i18n/tr';
import { FieldSelect, FieldCheckbox } from '@/components/ui/field';
import {
  PERIOD_PRESETS,
  PRESET_LABELS,
  periodLabel,
  presetRange,
  type PeriodPreset,
} from '@/lib/reports/period';

/**
 * Dönem + şube + kırılım süzgeci.
 *
 * SERBEST TARİH ARALIĞI YOK, ön ayarlar var. Raporların gerçekte sorulan
 * soruları sonlu: "bu ay", "geçen ay", "son 30 gün". Serbest aralık iki tarih
 * seçici, bir doğrulama ve bir de "bitiş başlangıçtan önce" hata durumu
 * getirirdi; hepsi, kimsenin sormadığı bir soru için. Gerekirse eklenir —
 * `presetRange` zaten yarı açık aralık üretiyor ve alt yapı hazır.
 */

interface GroupOption {
  value: string;
  label: string;
}

interface Props {
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  compare: boolean;
  onCompareChange: (compare: boolean) => void;
  groupBy?: string | undefined;
  groupOptions?: readonly GroupOption[] | undefined;
  onGroupByChange?: ((groupBy: string) => void) | undefined;
  /** Sağ tarafa yerleşen ek düğmeler (CSV indirme). */
  actions?: ReactNode | undefined;
}

export function ReportFilters({
  preset,
  onPresetChange,
  compare,
  onCompareChange,
  groupBy,
  groupOptions,
  onGroupByChange,
  actions,
}: Props): ReactNode {
  const { branches, branchId, setBranchId, canSelectAll, loading } = useBranch();

  return (
    <div className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
      <FieldSelect
        label={t('reports.period')}
        className="min-w-40"
        value={preset}
        onChange={(event) => onPresetChange(event.target.value as PeriodPreset)}
      >
        {PERIOD_PRESETS.map((option) => (
          <option key={option} value={option}>
            {PRESET_LABELS[option]}
          </option>
        ))}
      </FieldSelect>

      <FieldSelect
        label={t('reports.branch')}
        className="min-w-44"
        value={branchId ?? ''}
        disabled={loading}
        onChange={(event) => setBranchId(event.target.value === '' ? null : event.target.value)}
      >
        {/*
          "Tüm şubeler" YALNIZ kiracı geneli rollerde. Şube kapsamlı bir
          kullanıcı için boş değer "erişebildiğim şubeler" anlamına gelirdi
          ve sunucu öyle davranırdı — ama etiketin "tüm şubeler" demesi
          yanlış olurdu, göremediği şubeler var.
        */}
        {canSelectAll ? <option value="">{t('reports.allBranches')}</option> : null}
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </FieldSelect>

      {groupOptions === undefined || onGroupByChange === undefined ? null : (
        <FieldSelect
          label={t('reports.groupBy')}
          className="min-w-40"
          value={groupBy}
          onChange={(event) => onGroupByChange(event.target.value)}
        >
          {groupOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FieldSelect>
      )}

      <FieldCheckbox
        label={t('reports.compare')}
        checked={compare}
        onCheckedChange={onCompareChange}
        className="h-11 items-center"
      />

      <p className="pb-3 text-xs text-muted-foreground">{periodLabel(presetRange(preset))}</p>

      {actions === undefined ? null : <div className="ml-auto">{actions}</div>}
    </div>
  );
}
