import Foundation

/// Müşteri dosyaları — `apps/api/src/modules/files/dto/file.dto.ts`.
///
/// Dosya içeriği **API sürecinden geçmez**: istemci imzalı adrese doğrudan PUT
/// eder, sonra `confirm` ile kayıt açılır. Nesne anahtarı sunucuda üretilir;
/// istemciye bırakılsaydı başka bir kiracının yoluna yazmayı deneyebilirdi.

nonisolated enum FileKind: String, Codable, Sendable, CaseIterable, Identifiable {
    /// Klinik fotoğraf — sağlık verisidir (KVKK m.6), `customer.medical:*` ister.
    case photo
    /// Belge (kimlik fotokopisi, onam çıktısı) — `customer:*` yeter.
    case document

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .photo: return "Fotoğraf"
        case .document: return "Belge"
        }
    }
}

/// Öncesi/sonrası eşlemesindeki konum.
nonisolated enum FilePosition: String, Codable, Sendable, CaseIterable, Identifiable {
    case before
    case after
    case other

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .before: return "Öncesi"
        case .after: return "Sonrası"
        case .other: return "Diğer"
        }
    }
}

/// İndirme adresinin işaret ettiği nesne.
///
/// `thumb` yalnız ``CustomerFile/hasThumbnail`` doluyken çalışır; hazır
/// değilken sunucu `409` döner ve **tam boyuta düşmez** — ızgara farkında
/// olmadan 25 MB'lık nesneler indirirdi.
nonisolated enum FileVariant: String, Sendable {
    case original
    case thumb
}

/// Sunucunun kabul ettiği içerik tipleri. Beyaz liste, kara liste değil;
/// `image/svg+xml` bilinçli olarak YOK — SVG çalıştırılabilir içerik taşır.
nonisolated enum FileContentType {
    static let allowed = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "application/pdf",
    ]

    /// Sunucudaki `UPLOAD_MAX_BYTES` varsayılanı (25 MB). Yükleme öncesi
    /// küçültme hedefi; son söz yine sunucunun.
    static let maxBytes = 25 * 1024 * 1024
}

nonisolated struct CustomerFile: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let customerId: String
    let groupId: String?
    let kind: FileKind
    let position: FilePosition
    let mimeType: String
    let sizeBytes: Int
    let sha256: String?
    /// Küçük görsel hazır mı — kuyruk işi tamamlanınca dolar.
    let hasThumbnail: Bool
    let takenAt: Date?
    let uploadedBy: String?
    let createdAt: Date
}

nonisolated struct CustomerFileGroup: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let title: String
    let bodyArea: String?
    let serviceId: String?
    let files: [CustomerFile]
    let createdAt: Date

    func file(at position: FilePosition) -> CustomerFile? {
        files.first { $0.position == position }
    }
}

// MARK: - İstekler

nonisolated struct PresignUploadInput: Encodable, Sendable, Equatable {
    let customerId: String
    let contentType: String
    /// Bayt. Sunucu üst sınırı aşarsa reddeder ve `confirm` adımında boyutu
    /// **nesnenin kendisinden** okur — bu değer bir beyandır.
    let sizeBytes: Int
    let kind: FileKind
}

nonisolated struct PresignUploadResponse: Decodable, Sendable, Equatable {
    /// `confirm` adımına aynen verilecek anahtar.
    let storageKey: String
    /// İstemcinin doğrudan PUT edeceği adres.
    let uploadUrl: String
    /// PUT isteğinde AYNEN gönderilmesi gereken `Content-Type`.
    let contentType: String
    let expiresAt: Date
}

nonisolated struct ConfirmFileInput: Encodable, Sendable, Equatable {
    let storageKey: String
    let kind: FileKind
    var position: FilePosition?
    var groupId: String?
    /// İçeriğin sha256 özeti (hex). Worker nesneyi indirirken doğruluyor;
    /// uyuşmazlıkta kayıt `pending`e düşüyor.
    var sha256: String?
    var takenAt: Date?
}

nonisolated struct CreateFileGroupInput: Encodable, Sendable, Equatable {
    let title: String
    var bodyArea: String?
    var serviceId: String?
}

nonisolated struct DownloadURL: Decodable, Sendable, Equatable {
    let url: String
    let expiresAt: Date
}
