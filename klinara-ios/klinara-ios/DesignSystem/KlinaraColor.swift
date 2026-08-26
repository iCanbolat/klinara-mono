import SwiftUI

/// Klinara marka paleti — semantik token'lar.
///
/// Ekranlarda ham hex **kullanılmaz**; her renk buradan geçer. Değerler
/// `Assets.xcassets` içindeki Color Set'lerde light/dark varyantlı durur,
/// böylece sistem teması değiştiğinde renkler kod çalışmadan güncellenir.
///
/// | Token          | Light   | Dark    |
/// |----------------|---------|---------|
/// | sage           | #7F9A76 | #9DB894 |
/// | sageDeep       | #5E7856 | #7F9A76 |
/// | sageSoft       | #EAF0E7 | #2A322A |
/// | charcoal       | #2E3532 | #F2EFEA |
/// | charcoalMuted  | #6E7A74 | #A9B2AC |
/// | surface        | #FAF8F5 | #161917 |
/// | surfaceRaised  | #FFFFFF | #20241F |
/// | border         | #DFD9D0 | #33383A |
/// | danger         | #A6483C | #D08074 |
enum KlinaraColor {

    // MARK: Marka

    /// Birincil aksiyon, aktif durum, başarı.
    static let sage = Color("BrandSage")
    /// Basılı hâl ve vurgu.
    static let sageDeep = Color("BrandSageDeep")
    /// Seçili satır / bilgi zemini.
    static let sageSoft = Color("BrandSageSoft")

    // MARK: Metin

    /// Başlık ve gövde metni — "medical authority" kontrastı.
    static let charcoal = Color("Charcoal")
    /// İkincil metin, yardımcı açıklama.
    static let charcoalMuted = Color("CharcoalMuted")

    // MARK: Zemin

    /// Sayfa zemini. Saf beyaz **değil** — sıcak kırık beyaz.
    static let surface = Color("Surface")
    /// Kart ve input zemini.
    static let surfaceRaised = Color("SurfaceRaised")

    // MARK: Kenarlık ve durum

    static let border = Color("BorderNeutral")
    static let borderFocus = Color("BorderFocus")
    static let disabled = Color("DisabledFill")
    static let danger = Color("Danger")
}
