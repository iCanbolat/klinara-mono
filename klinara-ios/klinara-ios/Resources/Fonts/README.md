# Fontlar

| Dosya | Aile | Lisans | Kaynak |
|---|---|---|---|
| `Manrope-Variable.ttf` | Manrope | OFL 1.1 | google/fonts `ofl/manrope` |
| `SourceSerif4-Regular.ttf` | Source Serif 4 | OFL 1.1 | adobe-fonts/source-serif |
| `SourceSerif4-Semibold.ttf` | Source Serif 4 | OFL 1.1 | adobe-fonts/source-serif |

`Manrope-Variable.ttf` **değişken** bir fonttur ve tek dosyada `Manrope-Regular`,
`Manrope-Medium`, `Manrope-SemiBold` adlı örnekleri (named instances) taşır.
`UIFont(name:)` bu PostScript adlarıyla doğrudan çözer; ayrı statik dosya gerekmez.

Source Serif 4'te **Medium ağırlık yoktur** (ExtraLight, Light, Regular,
Semibold, Bold, Black). Başlıklar Semibold, ara başlıklar Regular kullanır.

Dosya adları `Info.plist` içindeki `UIAppFonts` listesiyle birebir eşleşmelidir.
