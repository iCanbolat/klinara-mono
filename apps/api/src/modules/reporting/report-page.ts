import { decodeCursor, encodeCursor, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../common/pagination';
import type { PageInfo } from '../../common/pagination';

/**
 * Rapor satırlarını sayfalar.
 *
 * **Neden ayrı bir yardımcı, `toPage` değil:** `toPage` veritabanından
 * `limit + 1` satır okunmuş bir listeyi bekliyor. Rapor satırları ise SQL'den
 * ham günlük kayıtlar olarak gelip uygulamada gruplanıyor; dilimlenecek dizi
 * zaten tamamen bellekte. Bu yüzden dilimleme **veritabanı işini azaltmıyor**,
 * yalnız gövdeyi küçültüyor: 12 aylık `groupBy=day` bir raporda 365 satır tek
 * yanıtta mobil istemciye iniyordu.
 *
 * **Sayfalama OPT-IN: `limit` verilmezse satırların tamamı döner.** Bu uçlar
 * bugüne kadar hep tam listeyi döndürdü ve web yönetim paneli raporları öyle
 * çiziyor; varsayılan bir sayfa boyutu koymak, o ekranları haber vermeden 50
 * satıra kırpmak — yani iOS'ta düzeltilen hatayı web'e taşımak — olurdu.
 * İsteyen istemci `limit` göndererek sayfalamayı açıyor.
 *
 * **Cursor hem sıra numarası hem çıpa taşıyor.** Salt offset, iki sayfa
 * arasında yazılan bir randevunun satırları kaydırmasıyla bir satırı atlar ya
 * da iki kez gösterir (`common/pagination` bu yüzden canlı listelerde
 * OFFSET kullanmıyor). Salt çıpa ise satır tamamen kaybolduğunda nereden devam
 * edileceğini söyleyemez. İkisi birlikte: çıpa hâlâ listedeyse ondan SONRA
 * devam edilir, kaybolmuşsa sıra numarasına düşülür.
 */
export interface ReportPageQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ReportPage<T> {
  data: T[];
  pageInfo: PageInfo;
}

export function pageRows<T>(
  rows: readonly T[],
  query: ReportPageQuery,
  keyOf: (row: T) => string,
): ReportPage<T> {
  const cursor = decodeCursor(query.cursor);
  if (query.limit === undefined && cursor === undefined) {
    return { data: [...rows], pageInfo: { nextCursor: null, hasMore: false } };
  }
  const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  let start = 0;
  if (cursor !== undefined) {
    const anchored = rows.findIndex((row) => keyOf(row) === cursor.id);
    const ordinal = Number.parseInt(cursor.sortKey, 10);
    start =
      anchored >= 0
        ? anchored + 1
        : Number.isFinite(ordinal)
          ? Math.max(ordinal, 0)
          : 0;
  }

  const data = rows.slice(start, start + limit);
  const hasMore = start + data.length < rows.length;
  const last = data.at(-1);

  return {
    data,
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ sortKey: String(start + data.length), id: keyOf(last) })
          : null,
    },
  };
}

/**
 * Gruplanmış rapor satırının kimliği.
 *
 * `groupId` gün kırılımında NULL — yerel tarih bir kimlik değil, etiketin
 * kendisi. Etiket o kırılımda tekil olduğu için çıpa görevini görüyor.
 */
export function groupKey(row: { groupId: string | null; groupLabel: string }): string {
  return row.groupId ?? row.groupLabel;
}
