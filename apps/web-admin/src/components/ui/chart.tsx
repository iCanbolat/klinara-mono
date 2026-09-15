'use client';

import {
  createContext,
  useContext,
  useId,
  useMemo,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import * as RechartsPrimitive from 'recharts';
import type { TooltipPayloadEntry } from 'recharts';
import { cn } from '@/lib/cn';

/*
 * shadcn `chart` bileşeni (https://ui.shadcn.com/docs/components/chart).
 *
 * Kaynağa sadık; iki uyarlama var:
 * - Tema anahtarları yalnız `light`: panelin karanlık teması yok, renkler
 *   zaten `--chart-N` tokenlarından geliyor.
 * - Tooltip/Legend içeriği recharts 3 tiplerine göre yazıldı (shadcn'in eski
 *   sürümü `payload`ı Tooltip prop'larından alıyordu; 3'te o prop yok).
 */

export type ChartConfig = Record<
  string,
  { label?: ReactNode; icon?: ComponentType; color?: string }
>;

interface ChartContextProps {
  config: ChartConfig;
}

const ChartContext = createContext<ChartContextProps | null>(null);

function useChart(): ChartContextProps {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: ComponentProps<'div'> & {
  config: ChartConfig;
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}): ReactNode {
  const uniqueId = useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;
  const value = useMemo(() => ({ config }), [config]);

  return (
    <ChartContext.Provider value={value}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }): ReactNode {
  const colorConfig = Object.entries(config).filter(([, item]) => item.color);
  if (colorConfig.length === 0) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colorConfig
          .map(([key, item]) => `  --color-${key}: ${item.color ?? ''};`)
          .join('\n')}\n}`,
      }}
    />
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  labelFormatter,
  formatter,
  labelClassName,
  color,
  nameKey,
  labelKey,
}: {
  active?: boolean | undefined;
  payload?: readonly TooltipPayloadEntry[] | undefined;
  label?: ReactNode;
  className?: string | undefined;
  hideLabel?: boolean | undefined;
  hideIndicator?: boolean | undefined;
  indicator?: 'line' | 'dot' | 'dashed' | undefined;
  nameKey?: string | undefined;
  labelKey?: string | undefined;
  labelClassName?: string | undefined;
  color?: string | undefined;
  labelFormatter?:
    ((label: ReactNode, payload: readonly TooltipPayloadEntry[]) => ReactNode) | undefined;
  /** Satır değerini biçimlendirir; `name` config etiketi çözülmüş haliyle gelir. */
  formatter?:
    ((value: number, name: ReactNode, item: TooltipPayloadEntry) => ReactNode) | undefined;
}): ReactNode {
  const { config } = useChart();

  const tooltipLabel = useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey ?? String(item?.dataKey ?? item?.name ?? 'value')}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn('font-medium', labelClassName)}>
          {labelFormatter(value ?? label, payload)}
        </div>
      );
    }
    if (!value) return null;
    return <div className={cn('font-medium', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item, index) => {
            const key = `${nameKey ?? String(item.name ?? item.dataKey ?? 'value')}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const payloadFill = (item.payload as { fill?: string } | undefined)?.fill;
            const indicatorColor = color ?? payloadFill ?? item.color;
            const name = itemConfig?.label ?? item.name;

            return (
              <div
                key={`${String(item.dataKey ?? index)}`}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:size-2.5 [&>svg]:text-muted-foreground',
                  indicator === 'dot' && 'items-center',
                )}
              >
                {itemConfig?.icon ? (
                  <itemConfig.icon />
                ) : (
                  !hideIndicator && (
                    <div
                      className={cn(
                        'shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)',
                        {
                          'size-2.5': indicator === 'dot',
                          'w-1': indicator === 'line',
                          'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                          'my-0.5': nestLabel && indicator === 'dashed',
                        },
                      )}
                      style={
                        {
                          '--color-bg': indicatorColor,
                          '--color-border': indicatorColor,
                        } as CSSProperties
                      }
                    />
                  )
                )}
                <div
                  className={cn(
                    'flex flex-1 justify-between gap-4 leading-none',
                    nestLabel ? 'items-end' : 'items-center',
                  )}
                >
                  <div className="grid gap-1.5">
                    {nestLabel ? tooltipLabel : null}
                    <span className="text-muted-foreground">{name}</span>
                  </div>
                  {item.value !== undefined && item.value !== null ? (
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {formatter
                        ? formatter(Number(item.value), name, item)
                        : Number(item.value).toLocaleString('tr-TR')}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export const ChartLegend = RechartsPrimitive.Legend;

export function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: {
  className?: string | undefined;
  hideIcon?: boolean | undefined;
  payload?: readonly RechartsPrimitive.LegendPayload[] | undefined;
  verticalAlign?: 'top' | 'bottom' | 'middle' | undefined;
  nameKey?: string | undefined;
}): ReactNode {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== 'none')
        .map((item) => {
          const key = `${nameKey ?? String(item.dataKey ?? 'value')}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={String(item.value)}
              className="flex items-center gap-1.5 [&>svg]:size-3 [&>svg]:text-muted-foreground"
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

/** Payload'dan config girdisini çözer: önce `key`, sonra iç `payload[key]`. */
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string,
): ChartConfig[string] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;

  const inner =
    'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null
      ? (payload.payload as Record<string, unknown>)
      : undefined;
  const outer = payload as Record<string, unknown>;

  let configLabelKey = key;
  if (typeof outer[key] === 'string') {
    configLabelKey = outer[key];
  } else if (inner && typeof inner[key] === 'string') {
    configLabelKey = inner[key];
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}
