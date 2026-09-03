/**
 * Varlık kimliği → görsel çözümlemesi. TEK uygulama, iki tüketici.
 *
 * İçerik dokümanı yalnız KİMLİK taşır (`imageAssetId`, `logoAssetId`,
 * `assetId`); ziyaretçiye giden yanıt ise çözülmüş görsel nesnesini taşır
 * (`image`, `logo`, …). Dönüşümü yapan `resolveAssets` sunucuda public yanıtı
 * üretiyor, yönetim panelinde ise KAYDEDİLMEMİŞ taslağın canlı önizlemesini.
 *
 * Bu yüzden burada: iki kopya olsaydı, bir gün biri yeni bir `*AssetId` alanını
 * tanır öbürü tanımazdı ve fark "önizlemede görsel var, yayında yok" (ya da
 * tersi) olarak — yani tam olarak önizlemenin var olma sebebini çürüterek —
 * ortaya çıkardı.
 *
 * Paketin sıfır çalışma zamanı bağımlılığı kuralı korunuyor: saf fonksiyonlar.
 */

import type { PublicImage } from './booking-content.js';

/**
 * `assetId` ya da `*AssetId` ile biten anahtarlar.
 *
 * Global bayrak YOK: `RegExp.test` global bir desende `lastIndex` taşır ve
 * ardışık çağrılar dönüşümlü olarak `false` döner.
 */
const ASSET_ID_KEY = /AssetId$|^assetId$/;

/** Anahtarın çözülmüş karşılığı: `assetId → image`, `logoAssetId → logo`. */
export function resolvedAssetKey(key: string): string {
  return key === 'assetId' ? 'image' : key.replace(/AssetId$/, '');
}

/** Dokümanda geçen tüm varlık kimlikleri — tekilleştirilmiş. */
export function collectAssetIds(document: {
  theme: unknown;
  sections: unknown;
  seo: unknown;
}): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string' && ASSET_ID_KEY.test(key)) ids.add(entry);
      else visit(entry);
    }
  };
  visit(document.theme);
  visit(document.sections);
  visit(document.seo);
  return [...ids];
}

/**
 * Dokümandaki `assetId` alanlarını çözülmüş görsellerle DEĞİŞTİRİR.
 *
 * İstemci `logoAssetId` görüp ikinci bir istek atmak zorunda kalmasın; sayfa
 * tek çağrıda render edilebilmeli. Dizinde bulunmayan (silinmiş ya da henüz
 * hazır olmayan) bir kimlik `null`a düşer — kırık bir adres yaymaktansa alanı
 * boş bırakmak daha iyi.
 */
export function resolveAssets(value: unknown, index: ReadonlyMap<string, PublicImage>): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveAssets(item, index));
  if (value === null || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && ASSET_ID_KEY.test(key)) {
      result[resolvedAssetKey(key)] = index.get(entry) ?? null;
      continue;
    }
    result[key] = resolveAssets(entry, index);
  }
  return result;
}
