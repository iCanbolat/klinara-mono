import Foundation

/// Metin araması — Türkçe için.
///
/// `lowercased()` + `contains` bu dilde çalışmıyor: `"YILMAZ".lowercased()`
/// noktalı `"yilmaz"` verir, `"Yılmaz".lowercased()` ise noktasız `"yılmaz"`.
/// İkisi eşleşmez ve kullanıcı kendi yazdığı adı bulamaz.
///
/// Aynı sınıftan bir sorun ``Slug`` içinde de çözülmüştü (Foundation'ın
/// katlaması `ı` harfini düşürüyor); orada slug üretimi için açık bir harf
/// haritası var, burada **arama** için aksan duyarsız karşılaştırma yeterli —
/// ek fayda olarak Türkçe klavyesi olmayan kullanıcı `"ayse"` yazıp
/// `"Ayşe"`yi bulabiliyor.
enum SearchText {

    /// Türkçe harflerin arama karşılığı.
    ///
    /// Foundation'ın aksan katlaması burada yetmiyor: `ı` bir aksanlı `i`
    /// değil, **ayrı bir temel harf**. `.diacriticInsensitive` onu `i`ye
    /// indirmez ve `"yilmaz"` araması `"Yılmaz"`ı bulamaz. `İ` de simetrik
    /// olarak `i`ye inmeli. ``Slug`` aynı sorunu aynı yöntemle çözüyor.
    private static let foldMap: [Character: Character] = [
        "ı": "i", "İ": "i", "I": "i",
        "ç": "c", "Ç": "c", "ğ": "g", "Ğ": "g",
        "ö": "o", "Ö": "o", "ş": "s", "Ş": "s", "ü": "u", "Ü": "u",
    ]

    /// Karşılaştırma biçimine indirger: Türkçe harfler ASCII'ye, kalan
    /// aksanlar Foundation'a, sonra küçük harfe.
    static func fold(_ value: String) -> String {
        String(value.map { foldMap[$0] ?? $0 })
            .folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US_POSIX"))
            .lowercased(with: Locale(identifier: "en_US_POSIX"))
    }

    /// Boş arama terimi her şeyle eşleşir — filtre uygulanmamış demektir.
    static func matches(_ haystack: String, term: String) -> Bool {
        let needle = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return true }
        return fold(haystack).contains(fold(needle))
    }

    /// Yalnız rakamları karşılaştırır — kullanıcı numarayı biçimli de yazsa
    /// (`0532 111 22 33`) E.164 kaydı (`+905321112233`) bulunabilmeli.
    static func matchesDigits(_ haystack: String?, term: String) -> Bool {
        let digits = term.filter(\.isNumber)
        guard !digits.isEmpty, let haystack else { return false }
        return haystack.filter(\.isNumber).contains(digits)
    }
}
