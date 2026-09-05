'use client';

import { useState, type ReactNode } from 'react';
import type { NoShowReport } from '@klinara/shared';
import { t } from '@/i18n/tr';
import { formatDelta, formatNumber, formatPercent } from '@/lib/reports/format';
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
  { value: 'service', label: 'Hizmet' },
  { value: 'day', label: 'Gün' },
] as const;

type Row = NoShowReport['data'][number];

export function NoShowReportView(): ReactNode {
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const [compare, setCompare] = useState(false);
  const [groupBy, setGroupBy] = useState<string>('staff');

  const { data, error, loading, range, branchId } = useReport<NoShowReport>({
    path: 'reports/no-show',
    preset,
    compare,
    groupBy,
  });

  const columns: Column<Row>[] = [
    { key: 'group', header: t('reports.col.group'), render: (row) => row.groupLabel },
    {
      key: 'total',
      header: t('reports.col.total'),
      numeric: true,
      render: (row) => formatNumber(row.total),
    },
    {
      key: 'completed',
      header: t('reports.col.completed'),
      numeric: true,
      render: (row) => formatNumber(row.completed),
    },
    {
      key: 'noShow',
      header: t('reports.col.noShow'),
      numeric: true,
      render: (row) => formatNumber(row.noShow),
    },
    {
      key: 'cancelled',
      header: t('reports.col.cancelled'),
      numeric: true,
      render: (row) => formatNumber(row.cancelled),
    },
    {
      key: 'noShowRate',
      header: t('reports.col.noShowRate'),
      numeric: true,
      render: (row) => formatPercent(row.noShowRate),
    },
  ];

  const delta = formatDelta(data?.delta?.noShowRate);

  return (
    <ReportShell
      title={t('reports.noShow')}
      description={t('reports.noShowHint')}
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
              path="reports/no-show/export"
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
            {t('reports.col.noShowRate')}: {formatPercent(data.totals.noShowRate)} ·{' '}
            {t('reports.col.cancellationRate')}: {formatPercent(data.totals.cancellationRate)}
            {compare ? (
              <span className="ml-2 text-muted-foreground">{delta ?? t('reports.deltaUnavailable')}</span>
            ) : null}
          </p>

          {/*
            Kaynak kırılımı ayrı: online randevunun gelmeme oranı, kapora
            almadan online randevu açma kararının ölçüsü (bkz. böl. 11, soru 8).
          */}
          {data.byOrigin.length === 0 ? null : (
            <dl className="mb-4 grid grid-cols-2 gap-3">
              {data.byOrigin.map((origin) => (
                <div key={origin.origin} className="rounded-md border border-border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">
                    {t('reports.summary.origin')} ·{' '}
                    {origin.origin === 'online'
                      ? t('reports.origin.online')
                      : t('reports.origin.internal')}
                  </dt>
                  <dd className="text-base font-semibold tabular-nums text-foreground">
                    {formatPercent(origin.noShowRate)}
                  </dd>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(origin.noShow)} / {formatNumber(origin.total)}
                  </p>
                </div>
              ))}
            </dl>
          )}

          <ReportChart
            kind={groupBy === 'day' ? 'line' : 'bar'}
            points={data.data.map((row) => ({ label: row.groupLabel, value: row.noShowRate }))}
            format={formatPercent}
          />

          <ReportTable
            caption={t('reports.noShow')}
            columns={columns}
            rows={data.data}
            rowKey={(row, index) => row.groupId ?? `${row.groupLabel}-${index}`}
            footer={[
              t('reports.col.total'),
              formatNumber(data.totals.total),
              formatNumber(data.totals.completed),
              formatNumber(data.totals.noShow),
              formatNumber(data.totals.cancelled),
              formatPercent(data.totals.noShowRate),
            ]}
          />
        </>
      )}
    </ReportShell>
  );
}
