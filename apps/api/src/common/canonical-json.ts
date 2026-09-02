/**
 * Kanonik JSON serileştirmesi — içerik hash'inin dayanağı.
 *
 * `JSON.stringify` nesne anahtarlarını EKLENME sırasında yazar. İçerik hash'i
 * buna dayansaydı, aynı içerik farklı bir sırayla ayrıştırıldığında farklı bir
 * hash üretirdi; `ETag` değişir, CDN gereksiz yere yeniden doğrular ve
 * "içerik değişti mi?" sorusu güvenilmez hâle gelirdi.
 *
 * Anahtarlar sıralanıyor, `undefined` alanlar düşürülüyor. Dizi sırası
 * KORUNUYOR — blokların sırası içeriğin kendisi.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry === undefined) continue;
    result[key] = canonicalize(entry);
  }
  return result;
}
