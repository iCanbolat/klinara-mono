'use client';

import { useState, type ReactNode } from 'react';
import type { RevenueReport } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { formatDelta, formatMoney } from '@/lib/reports/format';
import type { PeriodPreset } from '@/lib/reports/period';
import { ExportButton } from './export-button';
import { ReportChart } from './report-chart';
import { ReportFilters } from './report-filters';
import { ReportShell } from './report-shell';
import { ReportTable, type Column } from './report-table';
import { useReport } from './use-report';

const GROUPS = [
  { value: 'service', label: 'Hizmet' },
  { value: 'package', label: 'Paket' },
  { value: 'staff', label: 'Personel' },
  { value: 'branch', label: 'Şube' },
  { value: 'day', label: 'Gün' },
] as const;

type Row = RevenueReport['data'][number];

export function RevenueReportView(): ReactNode {
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [compare, setCompare] = useState(false);
  const [groupBy, setGroupBy] = useState<string>('service');

  const { data, error, loading, range, branchId } = useReport<RevenueReport>({
    path: 'reports/revenue',
    preset,
    compare,
    groupBy,
  });

  const currency = data?.totals.currency ?? 'TRY';

  const columns: Column<Row>[] = [
    { key: 'group', header: t('reports.col.group'), render: (row) => row.groupLabel },
    {
      key: 'accrued',
      header: t('reports.col.accrued'),
      numeric: true,
      render: (row) => formatMoney(row.accruedMinor, currency),
    },
  ];

  const delta = formatDelta(data?.delta?.accruedMinor);

  return (
    <ReportShell
      title={t('reports.revenue')}
      description={t('reports.revenueHint')}
      scope={data?.scope}
      error={error}
      loading={loading}
      filters={
        <ReportFilters
          preset={preset}
          onPresetChange={setPreset}
          compare={compare}
          onCompareChange={setCompare}
          groupBy={groupBy}
          groupOptions={GROUPS}
          onGroupByChange={setGroupBy}
          actions={
            <ExportButton
              path="reports/revenue/export"
              body={{ from: range.from, to: range.to, groupBy }}
              {...(branchId === null ? {} : { branchId })}
            />
          }
        />
      }
    >
      {data === null ? null : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={t('reports.col.accrued')}
              value={formatMoney(data.totals.accruedMinor, currency)}
              hint={compare ? (delta ?? t('reports.deltaUnavailable')) : undefined}
            />
          </dl>

          <ReportChart
            kind={groupBy === 'day' ? 'line' : 'bar'}
            points={data.data.map((row) => ({
              label: row.groupLabel,
              value: row.accruedMinor,
            }))}
            format={(value) => formatMoney(value, currency)}
          />

          <ReportTable
            caption={t('reports.revenue')}
            columns={columns}
            rows={data.data}
            rowKey={(row, index) => row.groupId ?? `${row.groupLabel}-${index}`}
          />
        </>
      )}
    </ReportShell>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}): ReactNode {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-foreground">{value}</dd>
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
