import { customType } from 'drizzle-orm/pg-core';

/** `citext` — büyük/küçük harf duyarsız metin (slug, e-posta). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/**
 * `integer[]` — hatırlatma saatleri gibi küçük sayı listeleri.
 *
 * node-postgres `int4[]` sütunlarını ZATEN JS dizisine çevirir, dolayısıyla
 * `fromDriver` çoğu zaman bir dizi alır. Yine de ham `{24,2}` metni gelme
 * ihtimaline karşı iki biçimi de karşılıyoruz.
 */
export const integerArray = customType<{ data: number[]; driverData: string | number[] }>({
  dataType: () => 'integer[]',
  fromDriver: (value) => {
    if (Array.isArray(value)) return value.map(Number);
    return String(value)
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((part) => part.length > 0)
      .map(Number);
  },
  toDriver: (value) => `{${value.join(',')}}`,
});

/** `text[]` — WebAuthn transport listesi gibi kısa metin dizileri. */
export const textArray = customType<{ data: string[]; driverData: string | string[] }>({
  dataType: () => 'text[]',
  fromDriver: (value) => {
    if (Array.isArray(value)) return value;
    return String(value)
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((part) => part.length > 0);
  },
  toDriver: (value) => `{${value.join(',')}}`,
});

/** `inet` — istek IP'si (denetim ve hız sınırı kayıtlarında). */
export const inet = customType<{ data: string }>({
  dataType: () => 'inet',
});
