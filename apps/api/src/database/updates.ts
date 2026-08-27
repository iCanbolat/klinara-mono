/**
 * Kısmi güncelleme (PATCH) yardımcıları.
 *
 * ⚠️ Buradaki `definedValues` şart. Repository'lerde güncelleme değerleri daima
 * bir nesne LİTERALİ ile kurulur (`{ name: input.name, slug: input.slug, … }`),
 * yani gönderilmeyen alanlar bile ANAHTAR olarak vardır ve değeri `undefined`
 * olur. `Object.keys(...)` bu anahtarları sayar; "değişecek alan var mı?"
 * kontrolü bu yüzden daima "var" der. Ardından Drizzle `.set()` undefined
 * değerleri kendisi eler, geriye hiçbir şey kalmaz ve `No values to set`
 * fırlatır — yani tamamen meşru bir istek (ör. bir hizmetin YALNIZ şube
 * override'ını güncellemek) istemciye 500 olarak döner.
 */

/** Tüm alanları opsiyonel, açıkça `undefined` taşıyabilen güncelleme demeti. */
export type Updatable<T> = { [K in keyof T]?: T[K] | undefined };

/**
 * `undefined` alanları atar; geriye GERÇEKTEN yazılacak alanlar kalır.
 *
 * `null` KORUNUR: `null` "bu alanı temizle" demektir ve `undefined`ten
 * (dokunma) anlamlı biçimde ayrılır.
 */
export function definedValues<T extends object>(values: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

/** Yazılacak bir alan var mı — `definedValues` sonrasında kullanılır. */
export function hasUpdates<T extends object>(values: Partial<T>): boolean {
  return Object.keys(values).length > 0;
}
