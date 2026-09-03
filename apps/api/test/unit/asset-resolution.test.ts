import { describe, expect, it } from 'vitest';
import { collectAssetIds, resolveAssets, type PublicImage } from '@klinara/shared';

const IMAGE: PublicImage = { url: 'https://cdn.example/a.webp', alt: 'Kapak', width: 1200, height: 630 };
const index = new Map<string, PublicImage>([['asset-1', IMAGE]]);

/**
 * Bu dönüşüm ARTIK İKİ YERDE koşuyor: sunucu public yanıtı üretirken, yönetim
 * paneli kaydedilmemiş taslağı önizlerken. Kopya olmaması için
 * `@klinara/shared`e taşındı ve testi buraya kondu — `content-dictionary.test.ts`
 * blok sözlüğü için aynı işi yapıyor.
 *
 * Ayrışmanın bedeli somut olurdu: "önizlemede görsel var, yayında yok" (ya da
 * tersi), yani önizlemenin var olma sebebinin çürümesi.
 */
describe('varlık çözümlemesi', () => {
  it('`assetId` → `image`, `*AssetId` → önek', () => {
    const resolved = resolveAssets(
      { imageAssetId: 'asset-1', logoAssetId: 'asset-1', assetId: 'asset-1' },
      index,
    ) as Record<string, unknown>;

    expect(resolved).toEqual({ image: IMAGE, logo: IMAGE });
    // `assetId` ve `imageAssetId` ikisi de `image`e düşüyor; aynı nesnede
    // birlikte bulunmaları içerik sözlüğünde mümkün değil.
    expect(resolved).not.toHaveProperty('imageAssetId');
    expect(resolved).not.toHaveProperty('assetId');
  });

  it('bulunmayan kimlik `null`a düşüyor, alan KAYBOLMUYOR', () => {
    // Kırık bir adres yaymaktansa boş bırakmak; ama alanın hiç olmaması
    // istemcide "bu blokta görsel alanı yok" gibi görünürdü.
    expect(resolveAssets({ imageAssetId: 'yok' }, index)).toEqual({ image: null });
  });

  it('iç içe dizilerde ve nesnelerde çalışıyor', () => {
    const resolved = resolveAssets(
      [{ type: 'carousel', items: [{ assetId: 'asset-1', caption: 'Salon' }] }],
      index,
    );
    expect(resolved).toEqual([
      { type: 'carousel', items: [{ image: IMAGE, caption: 'Salon' }] },
    ]);
  });

  it('varlık OLMAYAN alanlara dokunmuyor', () => {
    const document = { title: 'Klinik', zoom: 15, visible: false, tags: ['a', 'b'] };
    expect(resolveAssets(document, index)).toEqual(document);
  });

  it('`assetId` ile biten ama string OLMAYAN değer olduğu gibi kalıyor', () => {
    // Şema bunu üretmiyor ama gelirse `index.get(undefined)` çağırmamalıyız.
    expect(resolveAssets({ imageAssetId: null }, index)).toEqual({ imageAssetId: null });
  });

  it('kimlikler TEKİLLEŞTİRİLEREK toplanıyor', () => {
    const ids = collectAssetIds({
      theme: { logoAssetId: 'asset-1' },
      sections: [
        { type: 'hero', imageAssetId: 'asset-1' },
        { type: 'carousel', items: [{ assetId: 'asset-2' }, { assetId: 'asset-3' }] },
      ],
      seo: { ogImageAssetId: 'asset-2' },
    });
    expect([...ids].sort()).toEqual(['asset-1', 'asset-2', 'asset-3']);
  });

  it('KRİTİK: ardışık çağrılar aynı sonucu veriyor', () => {
    // Anahtar deseninde global bayrak olsaydı `lastIndex` taşınır ve desen
    // dönüşümlü olarak eşleşmezdi — testte bir kez koşan bir iddia bunu
    // yakalamazdı.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(resolveAssets({ imageAssetId: 'asset-1' }, index)).toEqual({ image: IMAGE });
      expect(collectAssetIds({ theme: {}, sections: [{ imageAssetId: 'asset-1' }], seo: {} })).toEqual([
        'asset-1',
      ]);
    }
  });
});
