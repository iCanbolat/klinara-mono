'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { t, type MessageKey } from '@/i18n/tr';
import { useBranch } from '@/components/session/branch-provider';
import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { SegmentButton, Segmented } from '@/components/ui/segmented';
import type { BranchChartRow, BranchMetric } from '@/lib/dashboard/summary';
import { formatMoney, formatNumber, formatPercent } from '@/lib/reports/format';

/**
 * Şube karşılaştırması — shadcn yatay çubuk grafiği, gösterge seçmeli.
 *
 * Kartlar şube sayısıyla birlikte aşağı uzuyordu ve iki şubeyi karşılaştırmak
 * göz gezdirmeyi gerektiriyordu; çubuk aynı soruyu tek bakışta yanıtlıyor.
 * Göstergelerin birimleri farklı (adet, yüzde, para) — hepsini tek eksende
 * toplamak yanıltırdı, o yüzden aynı anda TEK gösterge çiziliyor.
 *
 * Grafik `aria-hidden`; aynı sayılar ekran okuyucu için görünmez bir tabloda
 * (`report-chart.tsx` ile aynı kural: gerçeğin kaynağı tablo). Bir çubuğa
 * tıklamak o şubenin takvimini açıyor — eski kartın "Takvimi aç" düğmesi.
 *
 * Bilinmeyen gösterge (izin yok ya da rapor düştü) seçeneklerde HİÇ yok;
 * kartta "—" basmamakla aynı gerekçe.
 */

const METRIC_LABEL: Record<BranchMetric, MessageKey> = {
  today: 'dashboard.chart.today',
  occupancy: 'dashboard.branch.occupancy',
  revenue: 'dashboard.branch.revenue',
  noShow: 'dashboard.branch.noShow',
};

const TODAY_CONFIG = {
  completed: { label: t('dashboard.chart.completed'), color: 'var(--chart-1)' },
  pending: { label: t('dashboard.chart.pending'), color: 'var(--chart-2)' },
  dropped: { label: t('dashboard.chart.dropped'), color: 'var(--chart-5)' },
} satisfies ChartConfig;

const ROW_HEIGHT = 44;

export function BranchChart({
  rows,
  metrics,
  currency,
}: {
  rows: readonly BranchChartRow[];
  metrics: readonly BranchMetric[];
  currency: string;
}): ReactNode {
  const router = useRouter();
  const { setBranchId } = useBranch();
  const [picked, setPicked] = useState<BranchMetric | null>(null);
  // İlk açılışta ya da seçilen gösterge sonradan kaybolursa (yenilemede rapor
  // düştü) ilk erişilebilir göstergeye düş.
  const metric = picked !== null && metrics.includes(picked) ? picked : metrics[0];

  const format = useMemo(
    () =>
      (value: number): string => {
        if (metric === 'revenue') return formatMoney(value, currency);
        if (metric === 'occupancy' || metric === 'noShow') return formatPercent(value);
        return formatNumber(value);
      },
    [metric, currency],
  );

  if (metric === undefined) return null;

  const config: ChartConfig =
    metric === 'today'
      ? TODAY_CONFIG
      : { [metric]: { label: t(METRIC_LABEL[metric]), color: 'var(--chart-1)' } };
  const series = metric === 'today' ? (['completed', 'pending', 'dropped'] as const) : [metric];

  const openCalendar = (branchId: string): void => {
    setBranchId(branchId);
    router.push('/takvim');
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="dashboard-branches" className="text-title-m">
            {t('dashboard.branches')}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.branchCount', { count: rows.length })} ·{' '}
            {metric === 'today' ? t('dashboard.branch.today') : t('dashboard.thisMonth')}
          </span>
        </div>
        {metrics.length > 1 ? (
          <Segmented label={t('dashboard.chart.metric')}>
            {metrics.map((item) => (
              <SegmentButton key={item} pressed={item === metric} onClick={() => setPicked(item)}>
                {t(METRIC_LABEL[item])}
              </SegmentButton>
            ))}
          </Segmented>
        ) : null}
      </div>

      <div aria-hidden="true">
        <ChartContainer
          config={config}
          className="aspect-auto w-full"
          style={{
            height: Math.max(160, rows.length * ROW_HEIGHT + (metric === 'today' ? 72 : 40)),
          }}
        >
          <BarChart
            accessibilityLayer
            data={[...rows]}
            layout="vertical"
            margin={{ left: 4, right: 16 }}
            barCategoryGap={10}
          >
            <CartesianGrid horizontal={false} />
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              axisLine={false}
              width={112}
              tickFormatter={(value: string) =>
                value.length > 16 ? `${value.slice(0, 15)}…` : value
              }
            />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={format}
              allowDecimals={false}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent formatter={(value) => format(value)} />}
            />
            {metric === 'today' ? <ChartLegend content={<ChartLegendContent />} /> : null}
            {series.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                {...(metric === 'today' ? { stackId: 'today' } : {})}
                fill={`var(--color-${key})`}
                radius={
                  series.length === 1
                    ? 6
                    : index === 0
                      ? [6, 0, 0, 6]
                      : index === series.length - 1
                        ? [0, 6, 6, 0]
                        : 0
                }
                className="cursor-pointer"
                onClick={(data: { payload?: BranchChartRow }) => {
                  if (data.payload) openCalendar(data.payload.id);
                }}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </div>

      <table className="sr-only">
        <caption>{t('dashboard.branches')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('dashboard.chart.branch')}</th>
            {metrics.map((item) => (
              <th key={item} scope="col">
                {t(METRIC_LABEL[item])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.name}</th>
              {metrics.map((item) => (
                <td key={item}>{cellText(row, item, currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function cellText(row: BranchChartRow, metric: BranchMetric, currency: string): string {
  switch (metric) {
    case 'today':
      return formatNumber(row.completed + row.pending + row.dropped);
    case 'occupancy':
      return formatPercent(row.occupancy);
    case 'revenue':
      return formatMoney(row.revenue, currency);
    case 'noShow':
      return formatPercent(row.noShow);
  }
}
