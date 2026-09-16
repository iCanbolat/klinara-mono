import Foundation

// `apps/api/src/modules/staff/dto/staff.dto.ts` karşılıkları.

/// `StaffServiceResponseDto` — personelin bir hizmeti yapabildiğini söyleyen kayıt.
///
/// `branchId == nil` **kiracı geneli** yetkinlik demektir: personel bu hizmeti
/// tüm şubelerde yapabilir. Bir şube kimliği verilmişse yetkinlik yalnız orada geçerli.
nonisolated struct StaffServiceSkill: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let staffProfileId: String
    let serviceId: String
    let branchId: String?
    let customDurationMinutes: Int?
    let customPriceMinor: Int?
    let isActive: Bool
    let createdAt: Date
}

/// `StaffServiceInputDto`.
nonisolated struct StaffServiceSkillInput: Encodable, Sendable, Equatable {
    let serviceId: String
    var branchId: String?
    var customDurationMinutes: Int?
    var customPriceMinor: Int?
    var isActive: Bool?
}

/// `StaffProfileResponseDto`.
nonisolated struct StaffProfile: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let userId: String
    let userFullName: String
    let userEmail: String
    let primaryBranchId: String?
    /// Aktif **şube** üyeliklerinin şubeleri (kiracı kapsamlı roller hariç).
    /// Şube ve Personel güncellemesinden önceki sunucu göndermiyordu; yoksa boş sayılır.
    var branchIds: [String]? = nil
    let title: String?
    let specialties: [String]
    let calendarColor: String?
    let bio: String?
    let isVisibleOnline: Bool
    let isActive: Bool
    let createdAt: Date
    let services: [StaffServiceSkill]

    /// Personel bu şubeye ait mi — ana şubesi o şube **veya** orada rolü var.
    /// Sunucudaki `GET staff?branchId=` süzgeciyle aynı kural; Çalışma
    /// saatleri ve personel listesi bunu kullanıyor.
    func worksIn(branchId: String) -> Bool {
        primaryBranchId == branchId || (branchIds ?? []).contains(branchId)
    }

    /// Bir hizmetin bu personelde **o şubede** geçerli yetkinliği.
    /// Şube özel kaydı yoksa kiracı geneli kayda düşer — sunucudaki kuralın aynısı.
    func skill(for serviceId: String, in branchId: String?) -> StaffServiceSkill? {
        let candidates = services.filter { $0.serviceId == serviceId && $0.isActive }
        return candidates.first { $0.branchId == branchId } ?? candidates.first { $0.branchId == nil }
    }
}

/// `CreateStaffProfileDto`.
nonisolated struct CreateStaffProfileInput: Encodable, Sendable {
    let userId: String
    var primaryBranchId: String?
    var title: String?
    var specialties: [String]?
    var calendarColor: String?
    var bio: String?
    var isVisibleOnline: Bool?
    var isActive: Bool?
    var services: [StaffServiceSkillInput]?
}

/// `UpdateStaffProfileDto`.
///
/// Temizlenebilen alanlar ``Nullable``: `String?` ile "alanı boşalt" ve
/// "alana dokunma" aynı `nil` oluyordu ve iOS ana şubeyi, unvanı, rengi ve
/// tanıtımı **temizleyemiyordu** (Android A7.2'de bildirilen fark).
nonisolated struct UpdateStaffProfileInput: Encodable, Sendable, Equatable {
    var primaryBranchId: Nullable<String> = .unchanged
    var title: Nullable<String> = .unchanged
    var specialties: [String]?
    var calendarColor: Nullable<String> = .unchanged
    var bio: Nullable<String> = .unchanged
    var isVisibleOnline: Bool?
    var isActive: Bool?

    private enum CodingKeys: String, CodingKey {
        case primaryBranchId, title, specialties, calendarColor, bio, isVisibleOnline, isActive
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(primaryBranchId, forKey: .primaryBranchId)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(specialties, forKey: .specialties)
        try container.encode(calendarColor, forKey: .calendarColor)
        try container.encode(bio, forKey: .bio)
        try container.encodeIfPresent(isVisibleOnline, forKey: .isVisibleOnline)
        try container.encodeIfPresent(isActive, forKey: .isActive)
    }
}

extension Nullable {
    /// Mock'ların PATCH'i uygulaması için: `.unchanged` eski değeri korur.
    func applied(to old: Value?) -> Value? {
        switch self {
        case .unchanged: old
        case .clear: nil
        case .set(let value): value
        }
    }
}

/// `ReplaceStaffServicesDto` — listenin **tamamını** değiştirir.
nonisolated struct ReplaceStaffServicesInput: Encodable, Sendable {
    let services: [StaffServiceSkillInput]
}
