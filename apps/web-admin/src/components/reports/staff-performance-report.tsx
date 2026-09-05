'use client';

import { useState, type ReactNode } from 'react';
import type { StaffPerformanceReport } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { formatMinutes, formatMoney, formatNumber, formatPercent } from '@/lib/reports/format';
import type { PeriodPreset } from '@/lib/reports/period';
import { ExportButton } from './export-button';
import { ReportChart } from './report-chart';
import { ReportFilters } from './report-filters';
import { ReportShell } from './report-shell';
import { ReportTable, type Column } from './report-table';
import { useReport } from './use-report';

type Row = StaffPerformanceReport['data'][number];

export function StaffPerformanceReportView(): ReactNode {
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [compare, setCompare] = useState(false);

  const { data, error, loading, range, branchId } = useReport<StaffPerformanceReport>({
    path: 'reports/staff-performance',
    preset,
    compare,
  });

  const currency = data?.currency ?? 'TRY';

  const columns: Column<Row>[] = [
    { key: 'staff', header: t('reports.col.staff'), render: (row) => row.staffName },
    {
      key: 'completed',
      header: t('reports.col.completedServices'),
      numeric: true,
      render: (row) => formatNumber(row.completedServices),
    },
    {
      key: 'revenue',
      header: t('reports.col.accrued'),
      numeric: true,
      render: (row) => formatMoney(row.revenueMinor, currency),
    },
    {
      key: 'commission',
      header: t('reports.col.commission'),
      numeric: true,
      render: (row) => formatMoney(row.commissionMinor, currency),
    },
    {
      key: 'booked',
      header: t('reports.col.bookedMinutes'),
      numeric: true,
      render: (row) => formatMinutes(row.bookedMinutes),
    },
    {
      key: 'rate',
      header: t('reports.col.occupancyRate'),
      numeric: true,
      render: (row) => formatPercent(row.occupancyRate),
    },
  ];

  return (
    <ReportShell
      title={t('reports.staffPerformance')}
      description={t('reports.staffPerformanceHint')}
      scope={data?.scope}
      error={error}
      loading={loading}
      filters={
        <ReportFilters
          preset={preset}
          onPresetChange={setPreset}
          compare={compare}
          onCompareChange={setCompare}
          actions={
            <ExportButton
              path="reports/staff-performance/export"
              body={{ from: range.from, to: range.to }}
              {...(branchId === null ? {} : { branchId })}
            />
          }
        />
      }
    >
      {data === null ? null : (
        <>
          <ReportChart
            kind="bar"
            points={data.data.map((row) => ({
              label: row.staffName,
              value: row.revenueMinor,
            }))}
            format={(value) => formatMoney(value, currency)}
          />

          <ReportTable
            caption={t('reports.staffPerformance')}
            columns={columns}
            rows={data.data}
            rowKey={(row) => row.staffProfileId}
          />
        </>
      )}
    </ReportShell>
  );
}
