'use client';

import type { ReactNode } from 'react';
import { t } from '@/i18n/tr';

/**
 * Raporun BİRİNCİL gösterimi.
 *
 * Grafik değil tablo birincil: aynı sayıları hem ekran okuyucuya hem de
 * kopyalayıp yapıştıracak kullanıcıya veren tek biçim bu, ve CSV dışa
 * aktarımın da aynı kolonları taşıması sayıların iki yerde ayrışmamasını
 * sağlıyor.
 *
 * `icerik/surumler` sayfasının işaretlemesi izleniyor: `sr-only` bir
 * `<caption>` ve her başlıkta `scope="col"`.
 */

export interface Column<Row> {
  key: string;
  header: string;
  /** Sayısal kolonlar sağa yaslanır — göz basamakları alt alta okuyabilsin. */
  numeric?: boolean | undefined;
  render: (row: Row) => ReactNode;
}

interface Props<Row> {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  /** Alt toplam satırı — verilirse kalın olarak en alta eklenir. */
  footer?: readonly ReactNode[] | undefined;
}

export function ReportTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  footer,
}: Props<Row>): ReactNode {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('reports.empty')}</p>;
  }

  return (
    // Geniş tablo KENDİ içinde kayar; sayfa gövdesi yatay kaymaz.
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={
                  column.numeric === true
                    ? 'text-label py-3 pl-4 text-right text-muted-foreground'
                    : 'text-label py-3 pr-4 text-muted-foreground'
                }
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    column.numeric === true
                      ? 'py-3 pl-4 text-right tabular-nums'
                      : 'py-3 pr-4'
                  }
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer === undefined ? null : (
          <tfoot>
            <tr className="border-t-2 border-border text-body-emphasis">
              {footer.map((cell, index) => (
                <td
                  key={columns[index]?.key ?? String(index)}
                  className={
                    columns[index]?.numeric === true
                      ? 'py-3 pl-4 text-right tabular-nums'
                      : 'py-3 pr-4'
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
