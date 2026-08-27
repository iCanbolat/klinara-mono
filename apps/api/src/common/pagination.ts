import { ERROR_CODES } from '@klinara/shared';
import { AppError } from './errors/app-error';

/**
 * Cursor tabanlı sayfalama (API sözleşmesi 5.5).
 *
 * OFFSET kullanılmaz. Sebebi kayan sonuç problemi: takvim listesi okunurken
 * yeni bir randevu yazılırsa offset'li sayfalama bir kaydı atlar ya da iki kez
 * gösterir. Cursor son satırın (sıralama anahtarı, id) çiftini taşır; araya
 * giren kayıtlar sayfa sınırını bozmaz.
 *
 * `id` cursor'un parçasıdır çünkü sıralama anahtarı TEKİL DEĞİLDİR: aynı
 * saatte iki randevu olabilir ve yalnız zamanla ilerleyen bir cursor onlardan
 * birini sonsuza dek atlardı.
 */
export interface Cursor {
  sortKey: string;
  id: string;
}

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Page<T> {
  data: T[];
  pageInfo: PageInfo;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.sortKey}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (raw === undefined || raw.length === 0) return undefined;

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Cursor geçersiz');
  }

  const sortKey = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (sortKey.length === 0 || id.length === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'Cursor geçersiz');
  }
  return { sortKey, id };
}

/**
 * `limit + 1` satır okunmuş bir listeyi sayfaya çevirir.
 *
 * Fazladan bir satır istemek, "daha var mı?" sorusunu ikinci bir COUNT sorgusu
 * olmadan cevaplar.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null,
    },
  };
}
