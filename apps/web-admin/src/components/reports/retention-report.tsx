'use client';

import { useState, type ReactNode } from 'react';
import type { RetentionReport } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { formatDelta, formatNumber, formatPercent } from '@/lib/reports/format';
import type { PeriodPreset } from '@/lib/reports/period';
import { ExportButton } from './export-button';
import { ReportChart } from './report-chart';
import { ReportFilters } from './report-filters';
import { ReportShell } from './report-shell';
import { ReportTable, type Column } from './report-table';
import { useReport } from './use-report';

type AcquisitionRow = RetentionReport['acquisition'][number];
type CohortRow = RetentionReport['cohorts'][number];

export function RetentionReportView(): ReactNode {
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [compare, setCompare] = useState(false);

  const { data, error, loading, range, branchId } = useReport<RetentionReport>({
    path: 'reports/retention',
    preset,
    compare,
  });

  const acquisitionColumns: Column<AcquisitionRow>[] = [
    {
      key: 'source',
      header: t('reports.col.source'),
      render: (row) => row.source ?? t('reports.sourceUnknown'),
    },
    {
      key: 'customers',
      header: t('reports.col.customers'),
      numeric: true,
      render: (row) => formatNumber(row.customers),
    },
  ];

  const cohortColumns: Column<CohortRow>[] = [
    {
      key: 'cohort',
      header: t('reports.col.cohort'),
      render: (row) => `${row.withinDays} gün`,
    },
    {
      key: 'returned',
      header: t('reports.col.returned'),
      numeric: true,
      render: (row) => formatNumber(row.returned),
    },
    {
      key: 'rate',
      header: t('reports.col.rate'),
      numeric: true,
      render: (row) => formatPercent(row.rate),
    },
  ];

  const delta = formatDelta(data?.delta?.newCustomers);

  return (
    <ReportShell
      title={t('reports.retention')}
      description={t('reports.retentionHint')}
      error={error}
      loading={loading}
      note={t('reports.cohortWarning')}
      filters={
        <ReportFilters
          preset={preset}
          onPresetChange={setPreset}
          compare={compare}
          onCompareChange={setCompare}
          actions={
            <ExportButton
              path="reports/retention/export"
              body={{ from: range.from, to: range.to }}
              {...(branchId === null ? {} : { branchId })}
            />
          }
        />
      }
    >
      {data === null ? null : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-card p-3">
              <dt className="text-xs text-muted-foreground">{t('reports.summary.newCustomers')}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">
                {formatNumber(data.totals.newCustomers)}
              </dd>
              {compare ? (
                <p className="text-xs text-muted-foreground">
                  {delta ?? t('reports.deltaUnavailable')}
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <dt className="text-xs text-muted-foreground">{t('reports.summary.returningCustomers')}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">
                {formatNumber(data.totals.returningCustomers)}
              </dd>
              <p className="text-xs text-muted-foreground">{formatPercent(data.totals.returningRate)}</p>
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <dt className="text-xs text-muted-foreground">{t('reports.summary.activeCustomers')}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">
                {formatNumber(data.totals.activeCustomers)}
              </dd>
            </div>
          </dl>

          <ReportChart
            kind="bar"
            points={data.acquisition.map((row) => ({
              label: row.source ?? t('reports.sourceUnknown'),
              value: row.customers,
            }))}
            format={formatNumber}
          />

          <h2 className="mb-2 mt-4 text-sm font-medium text-foreground">{t('reports.col.source')}</h2>
          <ReportTable
            caption={t('reports.retention')}
            columns={acquisitionColumns}
            rows={data.acquisition}
            rowKey={(row, index) => row.source ?? `unknown-${index}`}
          />

          <h2 className="mb-2 mt-6 text-sm font-medium text-foreground">{t('reports.col.returned')}</h2>
          <ReportTable
            caption={t('reports.col.returned')}
            columns={cohortColumns}
            rows={data.cohorts}
            rowKey={(row) => String(row.withinDays)}
          />
        </>
      )}
    </ReportShell>
  );
}
