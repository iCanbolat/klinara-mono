# Randevu sayfası şablon görselleri

Yeni bir kliniğin randevu sayfası ilk açıldığında `BookingSiteProvisioner` bu
dosyaları kliniğin kendi kütüphanesine (`public/{tenantId}/…`) kopyalar ve
hazır şablonda kapak ile "Kliniğimizden" galerisinde kullanır
(`../default-template.ts`). `pnpm db:seed` demo klinik için aynı dosyaları
kullanır. `nest build` `*.webp` dosyalarını `dist`e kopyalar (`nest-cli.json`).

Kaynak: Unsplash, [Unsplash License](https://unsplash.com/license) (ücretsiz,
ticari kullanım serbest, atıf zorunlu değil). 1600 px genişliğe indirildi,
dikey kareler 3:2'ye kırpıldı ve WebP'ye çevrildi.

| Dosya | Kullanım | Kaynak |
|---|---|---|
| `hero-salon.webp` | Kapak, SEO görseli | https://unsplash.com/photos/X8Y3CJA0aNs |
| `cilt-bakimi.webp` | Galeri | https://unsplash.com/photos/4pDlorrrOOM |
| `lazer-epilasyon.webp` | Galeri | https://unsplash.com/photos/iN2ObRIy5Mc |
| `konsultasyon.webp` | Galeri | https://unsplash.com/photos/xREEa0dZmLY |
| `uygulama-odasi.webp` | Galeri | https://unsplash.com/photos/-i6kaig732w |

Klinikler görselleri editörden değiştirip silebilir; şablon yalnız başlangıç noktasıdır.
