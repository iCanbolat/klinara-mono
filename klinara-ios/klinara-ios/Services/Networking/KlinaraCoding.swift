import Foundation

/// JSON çözümleme ve kodlamanın tek yapılandırması.
///
/// **Neden ayrı bir dosya:** mock servis ile canlı servis aynı çözücüyü
/// kullanmazsa mock'ta geçen bir yanıt canlıda sessizce patlar. Nitekim öyle de
/// oldu: `JSONDecoder.dateDecodingStrategy = .iso8601` **saniye kesirlerini
/// kabul etmez**, sunucu ise `Date.toISOString()` ile daima `.000Z` üretir
/// (`phone.service.ts`). Mock fixture'ları kesirsiz biçim ürettiği için sorun
/// yalnız gerçek sunucuya bağlanınca görünürdü.
enum KlinaraCoding {

    // `ISO8601DateFormatter` yapılandırıldıktan sonra ayrıştırma için güvenlidir;
    // her tarih için yeniden kurmak 200 satırlık bir listede boşuna maliyettir.
    nonisolated(unsafe) private static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) private static let withoutFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parseTimestamp(_ raw: String) -> Date? {
        withFractionalSeconds.date(from: raw) ?? withoutFractionalSeconds.date(from: raw)
    }

    /// Sunucunun `Date.toISOString()` çıktısıyla aynı biçim — mock fixture'ları
    /// da bunu kullanır ki gerçekçi kalsın.
    static func timestamp(_ date: Date) -> String {
        withFractionalSeconds.string(from: date)
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            guard let date = parseTimestamp(raw) else {
                throw DecodingError.dataCorrupted(.init(
                    codingPath: decoder.codingPath,
                    debugDescription: "ISO 8601 tarih çözülemedi: \(raw)"
                ))
            }
            return date
        }
        return decoder
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(withFractionalSeconds.string(from: date))
        }
        return encoder
    }
}
