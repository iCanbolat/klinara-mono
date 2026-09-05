# Klinara marka varlıkları

`klinara-logo-source.png` — tasarımdan gelen ham logo (işaret + "KLINARA" kelime
markası, beyaz zemin, 1024×1024). **Tek doğru kaynak budur.**

`klinara-mark.png` — yalnız işaret, şeffaf zemin, 1024×1024. Kaynaktan
`tools/brand/build-icons.mjs` ile TÜRETİLDİ, elle çizilmedi.

## Neden raster, neden SVG değil?

Elimizde vektör master yok. `KlinaraLogo.swift`teki vektör çizim gerçek logonun
değil, "asset yokken görünsün" diye yazılmış bir YAKLAŞIMIN kodu (dosyanın kendi
yorumu da böyle diyor) ve gerçek işarete benzemiyor; onu portlamak logoyu
bozardı. Rasteri otomatik trace etmek de kabul edilebilir sadakat vermedi.

Logo düz iki renkli ve beyaz zeminli olduğu için her piksel `a·renk + (1−a)·beyaz`
karışımı; üretim betiği bu denklemi tersine çözüp alfayı geri kazanıyor ve işareti
şeffaf zemine taşıyor. Yeniden renklendirme (dark/tinted ikonlar) bu sayede
mümkün. En büyük kullanım 1024 px (App Store ikonu) ve kaynak da 1024 px olduğu
için raster hiçbir yerde yetersiz kalmıyor.

**Tasarımcıdan vektör master gelirse:** `klinara-mark.png` yerine `.svg` konur ve
betik güncellenir; tüketiciler (iOS `LogoMark`, web `KlinaraMark`) yol dışında
değişmez.

## Yeniden üretim

```bash
node tools/brand/build-icons.mjs
```
