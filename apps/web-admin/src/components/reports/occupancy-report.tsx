'use client';

import { useState, type ReactNode } from 'react';
import type { OccupancyReport } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { formatDelta, formatMinutes, formatPercent } from '@/lib/reports/format';
import type { PeriodPreset } from '@/lib/reports/period';
import { ExportButton } from './export-button';
import { ReportChart } from './report-chart';
import { ReportFilters } from './report-filters';
import { ReportShell } from './report-shell';
import { ReportTable, type Column } from './report-table';
import { useReport } from './use-report';

const GROUPS = [
  { value: 'staff', label: 'Personel' },
  { value: 'branch', label: 'Şube' },
  { value: 'day', label: 'Gün' },
] as const;

type Row = OccupancyReport['data'][number];

export function OccupancyReportView(): ReactNode {
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [compare, setCompare] = useState(false);
  const [groupBy, setGroupBy] = useState<string>('staff');

  const { data, error, loading, range, branchId } = useReport<OccupancyReport>({
    path: 'reports/occupancy',
    preset,
    compare,
    groupBy,
  });

  const columns: Column<Row>[] = [
    { key: 'group', header: t('reports.col.group'), render: (row) => row.groupLabel },
    {
      key: 'booked',
      header: t('reports.col.bookedMinutes'),
      numeric: true,
      render: (row) => formatMinutes(row.bookedMinutes),
    },
    {
      key: 'available',
      header: t('reports.col.availableMinutes'),
      numeric: true,
      render: (row) => formatMinutes(row.availableMinutes),
    },
    {
      key: 'rate',
      header: t('reports.col.occupancyRate'),
      numeric: true,
      render: (row) => formatPercent(row.occupancyRate),
    },
  ];

  const delta = formatDelta(data?.delta?.occupancyRate);

  return (
    <ReportShell
      title={t('reports.occupancy')}
      description={t('reports.occupancyHint')}
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
              path="reports/occupancy/export"
              body={{ from: range.from, to: range.to, groupBy }}
              {...(branchId === null ? {} : { branchId })}
            />
          }
        />
      }
    >
      {data === null ? null : (
        <>
          <p className="mb-3 text-sm text-foreground">
            {formatPercent(data.totals.occupancyRate)} —{' '}
            {formatMinutes(data.totals.bookedMinutes)} /{' '}
            {formatMinutes(data.totals.availableMinutes)}
            {compare ? (
              <span className="ml-2 text-muted-foreground">
                {delta ?? t('reports.deltaUnavailable')}
              </span>
            ) : null}
          </p>

          <ReportChart
            kind={groupBy === 'day' ? 'line' : 'bar'}
            points={data.data.map((row) => ({
              label: row.groupLabel,
              value: row.occupancyRate,
            }))}
            format={formatPercent}
          />

          <ReportTable
            caption={t('reports.occupancy')}
            columns={columns}
            rows={data.data}
            rowKey={(row, index) => row.groupId ?? `${row.groupLabel}-${index}`}
            footer={[
              t('reports.col.total'),
              formatMinutes(data.totals.bookedMinutes),
              formatMinutes(data.totals.availableMinutes),
              formatPercent(data.totals.occupancyRate),
            ]}
          />
        </>
      )}
    </ReportShell>
  );
}
