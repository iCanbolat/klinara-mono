import Foundation

/// Müşteri notları — `apps/api/src/modules/crm/dto/note.dto.ts`.
///
/// `customers.notes` (kartın üstündeki tek serbest alan) ile karıştırılmamalı:
/// o kartın bir **niteliği**, bunlar zaman çizelgesine düşen **olaylar**.

/// Notun türü ve dolayısıyla kimin görebileceği.
///
/// `treatment` ve `internal` sağlık verisidir (KVKK m.6): sunucu bunları
/// `customer.medical:read` izni olmayana **sorgudan hiç döndürmüyor** — istemci
/// filtresi değil, SQL daraltması (Ek G).
nonisolated enum CustomerNoteKind: String, Codable, Sendable, CaseIterable, Identifiable {
    /// Serbest not. `customer:write` yeter.
    case general
    /// İşlem notu — klinik gözlem. `customer.medical:write` ister.
    case treatment
    /// İç klinik notu. `customer.medical:write` ister.
    case `internal`

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .general: return "Serbest not"
        case .treatment: return "İşlem notu"
        case .internal: return "İç not"
        }
    }

    /// Yazmak için `customer.medical:write` gerekiyor mu?
    var isClinical: Bool { self != .general }

    var icon: String {
        switch self {
        case .general: return "note.text"
        case .treatment: return "stethoscope"
        case .internal: return "lock.doc"
        }
    }
}

nonisolated struct CustomerNote: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let customerId: String
    /// Doluysa not bir randevuya bağlı işlem notudur.
    let appointmentId: String?
    let kind: CustomerNoteKind
    let body: String
    /// Müşteriye gösterilebilir mi — dışa açık bir uç henüz yok, alan Faz 9
    /// (online sayfa) için taşınıyor.
    let customerVisible: Bool
    let authorUserId: String?
    /// Metin her değiştiğinde **trigger** artırır; servis yazmaz, yazamaz.
    let version: Int
    let createdAt: Date
    let updatedAt: Date

    var wasEdited: Bool { version > 1 }
}

/// Düzenlemeden ÖNCEKİ metin. Trigger her metin değişiminde bir satır bırakır.
nonisolated struct CustomerNoteRevision: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let body: String
    let version: Int
    let editedBy: String?
    let editedAt: Date
}

nonisolated struct CreateNoteInput: Encodable, Sendable, Equatable {
    let body: String
    var kind: CustomerNoteKind = .general
    var appointmentId: String?
    var customerVisible: Bool?
}

/// Alanların hepsi opsiyonel; gönderilmeyen alana dokunulmuyor.
/// Burada ``Nullable`` gerekmiyor — sunucu tarafında bu uçta `null` ile
/// temizlenebilen bir alan yok.
nonisolated struct UpdateNoteInput: Encodable, Sendable, Equatable {
    var body: String?
    var kind: CustomerNoteKind?
    var customerVisible: Bool?
}
