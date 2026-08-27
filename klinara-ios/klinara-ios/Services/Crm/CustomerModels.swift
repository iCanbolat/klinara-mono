import Foundation

/// Müşteri kartı — `apps/api/src/modules/crm/dto/customer.dto.ts`.
///
/// Batch 3.0 çekirdeği (ad, telefon, e-posta, doğum tarihi, cinsiyet, not)
/// Batch 4.1 ile genişledi: adres, geliş kaynağı, etiketler, sunucu tarafı
/// arama ve mükerrer kayıt birleştirme.

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

/// Müşterinin kliniğe nereden geldiği. Sunucudaki `CUSTOMER_SOURCES` ile
/// birebir; sıra da aynı tutuluyor ki seçicideki düzen sunucu belgesine baksın.
nonisolated enum CustomerSource: String, Codable, Sendable, CaseIterable, Identifiable {
    case walkIn = "walk_in"
    case referral
    case instagram
    case google
    case website
    case whatsapp
    case other

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .walkIn: return "Kapıdan"
        case .referral: return "Tavsiye"
        case .instagram: return "Instagram"
        case .google: return "Google"
        case .website: return "Web sitesi"
        case .whatsapp: return "WhatsApp"
        case .other: return "Diğer"
        }
    }
}

/// Kiracı kapsamlı etiket. Tekillik sunucuda **katlanmış ada** göre:
/// "VIP", "Vip" ve "vıp" aynı etikettir (Ek G).
nonisolated struct CustomerTag: Codable, Sendable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    /// `#RRGGBB` ya da `nil`.
    let color: String?
}

nonisolated struct CustomerTagInput: Encodable, Sendable, Equatable {
    var name: String
    var color: String?
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
    let addressLine: String?
    let district: String?
    let city: String?
    let postalCode: String?
    let source: CustomerSource?
    /// Bu kayıt birleştirildiyse hayatta kalan kaydın kimliği. Elinde eski
    /// kimliğe link olan bir istemci nereye gideceğini buradan görüyor.
    let mergedIntoCustomerId: String?
    let tags: [CustomerTag]
    let createdAt: Date

    /// Adres alanlarının okunur birleşimi — hepsi boşsa `nil`.
    var addressSummary: String? {
        let parts = [addressLine, [district, city].compactMap { $0 }.joined(separator: " / ")]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    /// Etiket kümesi değişmiş bir kopya. Etiket adı ya da rengi düzenlendiğinde
    /// karttaki rozetin de değişmesi gerekiyor; tüm listeyi yeniden çekmek
    /// bir ad düzeltmesi için orantısızdı.
    func replacingTags(_ tags: [CustomerTag]) -> Customer {
        Customer(
            id: id,
            tenantId: tenantId,
            fullName: fullName,
            phone: phone,
            email: email,
            birthDate: birthDate,
            gender: gender,
            notes: notes,
            addressLine: addressLine,
            district: district,
            city: city,
            postalCode: postalCode,
            source: source,
            mergedIntoCustomerId: mergedIntoCustomerId,
            tags: tags,
            createdAt: createdAt
        )
    }

    /// YEREL eşleşme — yüklü bir listeyi anlık filtrelemek için.
    ///
    /// Liste ekranı artık `GET /customers/search`e gidiyor; bu yol randevu
    /// akışındaki müşteri seçici gibi zaten elde olan kaydı süzen yerlerde
    /// kalıyor. Katlama ``SearchText`` üzerinden ve sunucudaki
    /// `klinara_fold_tr()` ile **aynı haritayı** taşıyor: ikisi aynı sorguya
    /// aynı cevabı veriyor.
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
    var addressLine: String?
    var district: String?
    var city: String?
    var postalCode: String?
    var source: CustomerSource?
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
    var addressLine: Nullable<String> = .unchanged
    var district: Nullable<String> = .unchanged
    var city: Nullable<String> = .unchanged
    var postalCode: Nullable<String> = .unchanged
    var source: Nullable<CustomerSource> = .unchanged

    private enum CodingKeys: String, CodingKey {
        case fullName, phone, email, birthDate, gender, notes
        case addressLine, district, city, postalCode, source
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(fullName, forKey: .fullName)
        try container.encodeIfPresent(gender, forKey: .gender)
        try container.encode(phone, forKey: .phone)
        try container.encode(email, forKey: .email)
        try container.encode(birthDate, forKey: .birthDate)
        try container.encode(notes, forKey: .notes)
        try container.encode(addressLine, forKey: .addressLine)
        try container.encode(district, forKey: .district)
        try container.encode(city, forKey: .city)
        try container.encode(postalCode, forKey: .postalCode)
        try container.encode(source, forKey: .source)
    }

    /// Gönderilecek bir şey var mı — boş gövde sunucuda no-op ama gereksiz bir
    /// istek atmanın da anlamı yok.
    var isEmpty: Bool {
        fullName == nil && gender == nil
            && phone.isUnchanged && email.isUnchanged
            && birthDate.isUnchanged && notes.isUnchanged
            && addressLine.isUnchanged && district.isUnchanged
            && city.isUnchanged && postalCode.isUnchanged && source.isUnchanged
    }
}

// MARK: - Etiket ataması

/// `PUT /customers/:id/tags` — etiket kümesini TOPLUCA ayarlar.
/// Ekleme/çıkarma ucu yok: gönderilen liste yeni kümedir.
nonisolated struct PutCustomerTagsInput: Encodable, Sendable, Equatable {
    let tagIds: [String]
}

// MARK: - Birleştirme

nonisolated struct MergeCustomerInput: Encodable, Sendable, Equatable {
    /// Arşivlenecek MÜKERRER kayıt. Yoldaki kimlik hayatta kalır.
    let sourceCustomerId: String
}

nonisolated struct CustomerMergeResult: Decodable, Sendable, Equatable {
    let id: String
    let sourceCustomerId: String
    let targetCustomerId: String
    /// Tablo adı → taşınan satır sayısı. Ekranda "12 randevu taşındı" demek için.
    let moved: [String: Int]
    let customer: Customer

    /// Kullanıcıya gösterilecek özet: sıfır satır taşınan tablolar atlanır.
    var movedSummary: [(label: String, count: Int)] {
        let labels = [
            "appointments": "Randevu",
            "customer_bookings": "Randevu kaydı",
            "customer_notes": "Not",
            "customer_files": "Dosya",
            "customer_file_groups": "Fotoğraf grubu",
            "customer_tag_assignments": "Etiket",
        ]
        return moved
            .filter { $0.value > 0 }
            .map { (labels[$0.key] ?? $0.key, $0.value) }
            .sorted { $0.1 > $1.1 }
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
