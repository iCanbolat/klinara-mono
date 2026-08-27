import Foundation

/// Müşteri çekirdeği — `apps/api/src/modules/crm/dto/customer.dto.ts`.
///
/// Batch 3.0'ın dar kapsamı: ad, telefon, e-posta, doğum tarihi, cinsiyet, not.
/// Etiketler, mükerrer kayıt birleştirme ve sunucu tarafı arama Batch 4.1'e ait.

// MARK: - Alan temizleme

/// "Alanı temizle" ile "alana dokunma" ayrımı.
///
/// Sunucu `PATCH /customers/:id` gövdesinde `null` gönderimini **temizleme**,
/// alanın hiç gönderilmemesini **değiştirme** olarak yorumluyor. Swift'te
/// `String?` ikisini de `nil` yapar; bu enum farkı tipe taşır ve kendi
/// `encode(to:)`'unda `.unchanged` durumunda hiçbir şey yazmaz.
nonisolated enum Nullable<Value: Encodable & Sendable & Equatable>: Sendable, Equatable {
    case unchanged
    case set(Value)
    case clear

    var isUnchanged: Bool {
        if case .unchanged = self { return true }
        return false
    }

}

extension Nullable where Value == String {
    /// Boş metni temizleme sayar — form alanları boşaltıldığında beklenen davranış.
    static func text(_ raw: String?) -> Nullable<String> {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return .clear }
        return .set(trimmed)
    }
}

nonisolated enum CustomerGender: String, Codable, Sendable, CaseIterable, Identifiable {
    case female
    case male
    case other
    case undisclosed

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .female: return "Kadın"
        case .male: return "Erkek"
        case .other: return "Diğer"
        case .undisclosed: return "Belirtilmedi"
        }
    }
}

// MARK: - Kayıt

nonisolated struct Customer: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let fullName: String
    /// Kayıt anında E.164'e normalize edilir; kiracı içinde tekildir.
    let phone: String?
    let email: String?
    /// Çıplak tarih (`"1990-05-12"`) — ``Date`` değil. Bkz. ``BookingModels``.
    let birthDate: String?
    let gender: CustomerGender?
    let notes: String?
    let createdAt: Date

    /// Listede aranırken bakılan alanlar. Sunucuda arama ucu Batch 4.1'de
    /// gelecek; o güne kadar filtreleme istemcide.
    ///
    /// Karşılaştırma ``SearchText`` üzerinden: Türkçe'de `lowercased()` ile
    /// `contains` birleşimi `"YILMAZ"` ile `"Yılmaz"`ı eşleştiremiyor.
    func matches(_ term: String) -> Bool {
        guard !term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return true }
        if SearchText.matchesDigits(phone, term: term) { return true }
        if SearchText.matches(fullName, term: term) { return true }
        if let email, SearchText.matches(email, term: term) { return true }
        return false
    }
}

// MARK: - İstekler

nonisolated struct CreateCustomerInput: Encodable, Sendable, Equatable {
    let fullName: String
    /// Serbest biçimde gönderilebilir; sunucu E.164'e normalize eder.
    var phone: String?
    var email: String?
    var birthDate: String?
    var gender: CustomerGender?
    var notes: String?
}

/// Her alan üç durumlu: gönderilmedi / değer / `null`.
/// `fullName` ve `gender` **temizlenemez** — sunucu tipleri nullable değil.
nonisolated struct UpdateCustomerInput: Encodable, Sendable, Equatable {
    var fullName: String?
    var phone: Nullable<String> = .unchanged
    var email: Nullable<String> = .unchanged
    var birthDate: Nullable<String> = .unchanged
    var gender: CustomerGender?
    var notes: Nullable<String> = .unchanged

    private enum CodingKeys: String, CodingKey {
        case fullName, phone, email, birthDate, gender, notes
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(fullName, forKey: .fullName)
        try container.encodeIfPresent(gender, forKey: .gender)
        try container.encode(phone, forKey: .phone)
        try container.encode(email, forKey: .email)
        try container.encode(birthDate, forKey: .birthDate)
        try container.encode(notes, forKey: .notes)
    }

    /// Gönderilecek bir şey var mı — boş gövde sunucuda no-op ama gereksiz bir
    /// istek atmanın da anlamı yok.
    var isEmpty: Bool {
        fullName == nil && gender == nil
            && phone.isUnchanged && email.isUnchanged
            && birthDate.isUnchanged && notes.isUnchanged
    }
}

/// `KeyedEncodingContainer` uzantısı: `.unchanged` hiçbir şey yazmaz,
/// `.clear` açıkça `null` yazar. `encode(_:forKey:)`'in kendisi bunu
/// yapamaz — çağrıldığı anda anahtar zaten yazılmış olurdu.
extension KeyedEncodingContainer {
    mutating func encode<Value>(
        _ value: Nullable<Value>,
        forKey key: Key
    ) throws where Value: Encodable & Sendable & Equatable {
        switch value {
        case .unchanged: break
        case .clear: try encodeNil(forKey: key)
        case .set(let inner): try encode(inner, forKey: key)
        }
    }
}
