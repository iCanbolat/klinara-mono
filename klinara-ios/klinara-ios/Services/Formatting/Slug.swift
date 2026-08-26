import Foundation

/// Sunucunun `SLUG_PATTERN`'ine (`^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$`) uyan
/// kod üretimi.
///
/// Kullanıcı slug yazmak zorunda kalmasın diye addan türetilir. Türkçe
/// karakterler `Foundation`'ın genel çevirisine bırakılmaz: `ı` harfi bazı
/// dönüşümlerde tamamen düşer ve "Işıl" → "sl" gibi bir kod üretir.
enum Slug {

    private static let turkishMap: [Character: String] = [
        "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u",
        "Ç": "c", "Ğ": "g", "İ": "i", "I": "i", "Ö": "o", "Ş": "s", "Ü": "u",
    ]

    static func make(from name: String) -> String {
        var output = ""
        var lastWasSeparator = true

        for character in name {
            if let mapped = turkishMap[character] {
                output += mapped
                lastWasSeparator = false
            } else if character.isLetter || character.isNumber {
                let lowered = character.lowercased()
                // Türkçe dışı aksanlar (é, ü, â) ASCII'ye indirilir.
                let ascii = lowered.folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US_POSIX"))
                let filtered = ascii.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
                if filtered.isEmpty {
                    if !lastWasSeparator { output += "-"; lastWasSeparator = true }
                } else {
                    output += filtered
                    lastWasSeparator = false
                }
            } else if !lastWasSeparator {
                output += "-"
                lastWasSeparator = true
            }
        }

        // Baştaki/sondaki tireler desene takılır.
        var trimmed = output
        while trimmed.hasPrefix("-") { trimmed.removeFirst() }
        while trimmed.hasSuffix("-") { trimmed.removeLast() }
        return String(trimmed.prefix(50))
    }

    /// Sunucu en az 3, en çok 50 karakter ister.
    static func isValid(_ slug: String) -> Bool {
        let pattern = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
        return slug.count >= 3 && slug.count <= 50 && slug.wholeMatch(of: pattern) != nil
    }
}
