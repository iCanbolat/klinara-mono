import Foundation
import UniformTypeIdentifiers

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

    /// Dosya seçicinin göstereceği tipler — ``allowed`` listesinden türetiliyor.
    ///
    /// Ayrı bir liste yazılsaydı, sunucunun kabul ettiği bir tip seçicide
    /// görünmeyebilir ya da tersi olur, kullanıcı seçtikten SONRA reddedilirdi.
    static let allowedUTTypes: [UTType] = allowed.compactMap { UTType(mimeType: $0) }

    /// Gövdenin gerçek içerik tipi.
    ///
    /// Sıra bilinçli: önce **baytların imzası**, sonra dosya uzantısı. Uzantı
    /// bir iddiadır (`.pdf` uzantılı bir JPEG mümkün), imza ise içeriğin
    /// kendisidir; `presign` beyanı ile nesnenin gerçeği ayrışırsa imzalı PUT
    /// `Content-Type` uyuşmazlığına düşer.
    ///
    /// Tanınmayan içerik `nil` döner — **varsayılan tip yok**. Bir varsayılan,
    /// yanlış tipi sessizce kaydetmenin ta kendisidir.
    static func detect(data: Data, filenameExtension: String? = nil) -> String? {
        if let signature = signature(of: data) { return signature }
        guard let ext = filenameExtension, !ext.isEmpty,
              let type = UTType(filenameExtension: ext),
              let mime = type.preferredMIMEType,
              allowed.contains(mime)
        else { return nil }
        return mime
    }

    /// Sihirli bayt dizileri. WebP ve HEIC kapsayıcı biçimler: ilk dört bayt
    /// tipi vermiyor, marka alanına bakmak gerekiyor.
    private static func signature(of data: Data) -> String? {
        func matches(_ bytes: [UInt8], at offset: Int) -> Bool {
            guard data.count >= offset + bytes.count else { return false }
            let start = data.index(data.startIndex, offsetBy: offset)
            return Array(data[start..<data.index(start, offsetBy: bytes.count)]) == bytes
        }

        if matches(Array("%PDF".utf8), at: 0) { return "application/pdf" }
        if matches([0xFF, 0xD8, 0xFF], at: 0) { return "image/jpeg" }
        if matches([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], at: 0) { return "image/png" }
        if matches(Array("RIFF".utf8), at: 0), matches(Array("WEBP".utf8), at: 8) {
            return "image/webp"
        }
        if matches(Array("ftyp".utf8), at: 4) {
            let brands = ["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]
            if brands.contains(where: { matches(Array($0.utf8), at: 8) }) { return "image/heic" }
        }
        return nil
    }

    /// Listede gösterilecek ad. Ham MIME kullanıcıya bir şey anlatmıyor.
    static func turkishName(of mimeType: String) -> String {
        switch mimeType {
        case "application/pdf": return "PDF belge"
        case "image/jpeg": return "JPEG görsel"
        case "image/png": return "PNG görsel"
        case "image/webp": return "WebP görsel"
        case "image/heic": return "HEIC görsel"
        default: return "Belge"
        }
    }
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
