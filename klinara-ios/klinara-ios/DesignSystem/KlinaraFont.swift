import SwiftUI
import UIKit

/// Marka tipografisi: başlıklarda **Source Serif 4** (editoryal, otoriter),
/// arayüz ve gövdede **Manrope** (geometrik, klinik veride okunaklı).
///
/// Fontlar `Resources/Fonts` altından `UIAppFonts` ile yüklenir. Henüz
/// eklenmemişlerse tüm stiller sessizce sistem eşdeğerine düşer
/// (New York + SF Pro) — uygulama her hâlükârda çalışır ve okunur kalır.
/// Hangi yolun kullanıldığı `KlinaraFont.diagnostics` ile görülebilir.
enum KlinaraFont {

    // MARK: Aile adları

    private enum Family {
        static let serif = "SourceSerif4"
        static let sans = "Manrope"
    }

    /// PostScript adları. Font dosyaları eklendiğinde bunlar çözülür.
    private enum Face {
        /// Source Serif 4'te Medium ağırlık yoktur; ara başlıklar Regular kullanır.
        static let serifRegular = "SourceSerif4-Regular"
        static let serifSemibold = "SourceSerif4-Semibold"
        static let sansRegular = "Manrope-Regular"
        static let sansMedium = "Manrope-Medium"
        static let sansSemiBold = "Manrope-SemiBold"
    }

    // MARK: Kullanılabilirlik

    /// Bir kez hesaplanır; her `Font` erişiminde `UIFont(name:)` çağırmayız.
    private static let installed: Set<String> = {
        let names = [
            Face.serifRegular, Face.serifSemibold,
            Face.sansRegular, Face.sansMedium, Face.sansSemiBold,
        ]
        return Set(names.filter { UIFont(name: $0, size: 12) != nil })
    }()

    /// Özel font varsa onu, yoksa verilen sistem eşdeğerini döndürür.
    private static func font(
        _ face: String,
        size: CGFloat,
        relativeTo textStyle: Font.TextStyle,
        fallback: Font
    ) -> Font {
        installed.contains(face)
            ? .custom(face, size: size, relativeTo: textStyle)
            : fallback
    }

    // MARK: Başlıklar — Source Serif 4

    static var displayL: Font {
        font(Face.serifSemibold, size: 34, relativeTo: .largeTitle,
             fallback: .system(.largeTitle, design: .serif, weight: .semibold))
    }

    static var displayM: Font {
        font(Face.serifSemibold, size: 28, relativeTo: .title,
             fallback: .system(.title, design: .serif, weight: .semibold))
    }

    static var titleM: Font {
        font(Face.serifRegular, size: 22, relativeTo: .title2,
             fallback: .system(.title2, design: .serif, weight: .regular))
    }

    // MARK: Gövde ve arayüz — Manrope

    static var bodyL: Font {
        font(Face.sansRegular, size: 17, relativeTo: .body,
             fallback: .system(.body))
    }

    static var bodyM: Font {
        font(Face.sansRegular, size: 15, relativeTo: .subheadline,
             fallback: .system(.subheadline))
    }

    static var bodyEmphasis: Font {
        font(Face.sansMedium, size: 15, relativeTo: .subheadline,
             fallback: .system(.subheadline, weight: .medium))
    }

    static var button: Font {
        font(Face.sansSemiBold, size: 16, relativeTo: .callout,
             fallback: .system(.callout, weight: .semibold))
    }

    /// Bölüm ve input etiketleri. Uppercase + geniş tracking ile uygulanır.
    static var label: Font {
        font(Face.sansSemiBold, size: 12, relativeTo: .caption,
             fallback: .system(.caption, weight: .semibold))
    }

    /// Doğrulama kodu kutuları — tabular figürler şart.
    static var code: Font {
        installed.contains(Face.sansMedium)
            ? Font.custom(Face.sansMedium, size: 24, relativeTo: .title2).monospacedDigit()
            : .system(.title2, design: .monospaced, weight: .medium)
    }

    // MARK: Teşhis

    /// Font dosyalarının gerçekten paketlendiğini doğrulamak için.
    /// Sessizce sistem fontuna düşmüş olmayı yakalar.
    static var diagnostics: String {
        let serifOK = installed.contains(Face.serifSemibold)
        let sansOK = installed.contains(Face.sansRegular)
        return """
        \(Family.serif): \(serifOK ? "yüklü" : "YOK → New York")
        \(Family.sans): \(sansOK ? "yüklü" : "YOK → SF Pro")
        """
    }

    static var allInstalled: Bool { installed.count == 5 }
}

// MARK: - Metin stilleri

/// Font + tracking + harf durumunu **tek parça** olarak taşır.
/// Tracking'i çağrı yerinde tekrarlamak, er ya da geç bir ekranda unutulur.
enum KlinaraTextStyle {
    /// 34pt serif, sıkı tracking — ekran başlığı.
    case displayL
    /// 28pt serif — ekran başlığı (uzun metinli ekranlar).
    case displayM
    /// 22pt serif — bölüm başlığı, kart başlığı.
    case titleM
    /// 17pt — birincil gövde.
    case bodyL
    /// 15pt — ikincil gövde, yardımcı metin.
    case bodyM
    /// 15pt medium — vurgulu gövde.
    case bodyEmphasis
    /// 16pt semibold — buton içeriği.
    case button
    /// 12pt UPPERCASE, geniş tracking — mimari hiyerarşi.
    case label
    /// 24pt tabular — doğrulama kodu.
    case code

    var font: Font {
        switch self {
        case .displayL: KlinaraFont.displayL
        case .displayM: KlinaraFont.displayM
        case .titleM: KlinaraFont.titleM
        case .bodyL: KlinaraFont.bodyL
        case .bodyM: KlinaraFont.bodyM
        case .bodyEmphasis: KlinaraFont.bodyEmphasis
        case .button: KlinaraFont.button
        case .label: KlinaraFont.label
        case .code: KlinaraFont.code
        }
    }

    /// Başlıklar negatif (premium, "locked-in"), etiketler pozitif (mimari hiyerarşi).
    var tracking: CGFloat {
        switch self {
        case .displayL: -0.6
        case .displayM: -0.4
        case .titleM: -0.2
        case .label: 1.2
        case .code: 2
        default: 0
        }
    }

    var uppercased: Bool { self == .label }

    var lineSpacing: CGFloat {
        switch self {
        case .bodyL, .bodyM, .bodyEmphasis: 3
        default: 0
        }
    }
}

extension View {
    /// Marka metin stilini uygular: font, tracking, harf durumu ve satır aralığı.
    func klinaraText(_ style: KlinaraTextStyle) -> some View {
        font(style.font)
            .tracking(style.tracking)
            .lineSpacing(style.lineSpacing)
            .textCase(style.uppercased ? .uppercase : nil)
    }
}
