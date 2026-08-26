import SwiftUI

/// Ölçü ve hareket sabitleri. 4pt grid; cömert boşluk tasarımın
/// "clinical breathing room" ilkesinin doğrudan karşılığıdır.
enum KlinaraMetrics {

    // MARK: Boşluk (4pt grid)

    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 40

    /// Ekran yatay kenar boşluğu — her auth ekranında aynı.
    static let screenInset: CGFloat = 24
    /// Başlık bloğu ile ilk alan arası.
    static let headerToContent: CGFloat = 32
    /// Bağımsız bölümler arası.
    static let sectionGap: CGFloat = 40

    // MARK: Yarıçap

    static let controlRadius: CGFloat = 12
    static let cardRadius: CGFloat = 16

    // MARK: Kontrol ölçüleri

    static let controlHeight: CGFloat = 52
    static let fieldHeight: CGFloat = 52
    static let borderWidth: CGFloat = 1
    static let focusBorderWidth: CGFloat = 1.5

    // MARK: Hareket
    //
    // Sakin ve ölçülü. Uyarıcı, zıplayan ya da dikkat çeken animasyon yok —
    // marka kişiliği "calm, authoritative".

    /// Akış adımları arası geçiş.
    static let stepTransition: Animation = .smooth(duration: 0.28)
    /// Hata görünüp kaybolurken.
    static let feedback: Animation = .snappy(duration: 0.2)
}
