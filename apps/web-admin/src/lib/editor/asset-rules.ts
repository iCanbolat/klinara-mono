import { ASSET_LIMITS, type AssetMimeType } from '@klinara/shared';

/**
 * Yükleme ön denetimi.
 *
 * Sunucu bu kuralları zaten uyguluyor (hem presign hem confirm anında); buradaki
 * kontrol kullanıcıya 5 MB'lık bir dosyayı YÜKLEDİKTEN SONRA "olmadı" dememek
 * için. Özellikle SVG: sunucunun reddi doğru ama kullanıcı sebebini bilmez;
 * dosya seçerken söylemek gerekiyor.
 */
export type AssetRejection = 'too-large' | 'svg' | 'wrong-type' | null;

export function checkAsset(file: { type: string; size: number }): AssetRejection {
  if (file.type === 'image/svg+xml') return 'svg';
  if (!(ASSET_LIMITS.mimeTypes as readonly string[]).includes(file.type)) return 'wrong-type';
  if (file.size > ASSET_LIMITS.maxBytes) return 'too-large';
  return null;
}

export function isAllowedMime(type: string): type is AssetMimeType {
  return (ASSET_LIMITS.mimeTypes as readonly string[]).includes(type);
}

/** `<input accept>` değeri — dosya seçicide yanlış türü hiç göstermemek için. */
export const ACCEPT_ATTRIBUTE = ASSET_LIMITS.mimeTypes.join(',');

export const MAX_MEGABYTES = Math.round(ASSET_LIMITS.maxBytes / (1024 * 1024));
