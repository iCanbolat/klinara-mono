'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * `DataPage` için hazır tablo — sayfalar isterse kullanır, isterse
 * `renderTable`a kendi tablosunu verir.
 *
 * İşaretleme `reports/report-table.tsx` ile aynı: `sr-only` `<caption>`,
 * her başlıkta `scope="col"`, sayısal kolonlar sağa yaslı. Geniş tablo kendi
 * içinde kayar; sayfa gövdesi yatay kaymaz.
 */

export interface DataColumn<Row> {
  key: string;
  header: ReactNode;
  numeric?: boolean | undefined;
  /** Eylem kolonu gibi sağa yaslanacak ama sayı olmayan hücreler. */
  align?: 'start' | 'end' | undefined;
  className?: string | undefined;
  render: (row: Row) => ReactNode;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
}: {
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}): ReactNode {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'text-label px-4 py-3 whitespace-nowrap text-muted-foreground',
                  alignEnd(column) && 'text-right',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-4 py-3 align-middle',
                    column.numeric === true && 'tabular-nums',
                    alignEnd(column) && 'text-right',
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function alignEnd<Row>(column: DataColumn<Row>): boolean {
  return column.numeric === true || column.align === 'end';
}
