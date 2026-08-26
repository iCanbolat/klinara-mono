import Foundation

/// Para biçimlendirme ve ayrıştırma — **tek yer**.
///
/// Sunucu tarafındaki kural burada da geçerlidir: tutarlar kuruş cinsinden
/// `Int` taşınır, `Double`'a **çevrilmez**. Bir kez `Double`'a düşen tutar
/// 0,1 + 0,2 ≠ 0,3 dünyasına girer ve taksit toplamları tutmamaya başlar.
enum Money {

    nonisolated(unsafe) private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.currencyCode = "TRY"
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter
    }()

    /// Kuruş → "1.500,00 ₺".
    static func format(minor: Int, currency: String = "TRY") -> String {
        // `NSDecimalNumber` ile bölüyoruz: 250_000 / 100 tamsayı bölmesinde
        // kuruşu düşürürdü, `Double` bölmesi ise 2.500,0000000001 üretebilirdi.
        let value = NSDecimalNumber(value: minor)
            .dividing(by: 100, withBehavior: roundingBehavior)
        formatter.currencyCode = currency
        return formatter.string(from: value) ?? "\(minor)"
    }

    /// Sembolsüz biçim — giriş alanının içinde sembol tekrar edilmesin diye.
    static func formatPlain(minor: Int) -> String {
        let value = NSDecimalNumber(value: minor).dividing(by: 100, withBehavior: roundingBehavior)
        return plainFormatter.string(from: value) ?? "\(minor)"
    }

    /// Kullanıcının yazdığı metni kuruşa çevirir. "1.500,50" ve "1500.50" ikisi de kabul.
    /// Ayrıştırılamayan girdi `nil` döner — sessizce 0 kabul etmek, kullanıcının
    /// yazdığından farklı bir fiyat kaydetmenin en kestirme yoludur.
    static func parse(_ text: String) -> Int? {
        let cleaned = text
            .replacingOccurrences(of: "₺", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\u{00A0}", with: "")
            .replacingOccurrences(of: ".", with: "")
            .replacingOccurrences(of: ",", with: ".")
            .trimmingCharacters(in: .whitespaces)

        guard !cleaned.isEmpty else { return nil }
        let decimal = NSDecimalNumber(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
        guard decimal != .notANumber else { return nil }

        let minor = decimal.multiplying(by: 100, withBehavior: roundingBehavior)
        guard minor.compare(NSDecimalNumber.zero) != .orderedAscending else { return nil }
        return minor.intValue
    }

    private static let roundingBehavior = NSDecimalNumberHandler(
        roundingMode: .bankers,
        scale: 2,
        raiseOnExactness: false,
        raiseOnOverflow: false,
        raiseOnUnderflow: false,
        raiseOnDivideByZero: false
    )

    nonisolated(unsafe) private static let plainFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return formatter
    }()
}

/// KDV oranı — sunucu **baz puan** (bps) taşır: %20 = 2000.
enum VatRate {

    static func format(basisPoints: Int) -> String {
        let percent = Double(basisPoints) / 100
        return percent == percent.rounded()
            ? "%\(Int(percent))"
            : String(format: "%%%.2f", percent)
    }

    /// Yaygın Türkiye KDV oranları — seçici için.
    static let common: [Int] = [0, 1000, 2000]
}

/// Süre biçimlendirme: 90 → "1 sa 30 dk".
enum DurationFormat {

    static func format(minutes: Int) -> String {
        let hours = minutes / 60
        let remaining = minutes % 60
        return switch (hours, remaining) {
        case (0, _): "\(remaining) dk"
        case (_, 0): "\(hours) sa"
        default: "\(hours) sa \(remaining) dk"
        }
    }
}
