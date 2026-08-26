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
    let title: String?
    let specialties: [String]
    let calendarColor: String?
    let bio: String?
    let isVisibleOnline: Bool
    let isActive: Bool
    let createdAt: Date
    let services: [StaffServiceSkill]

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
nonisolated struct UpdateStaffProfileInput: Encodable, Sendable {
    var primaryBranchId: String?
    var title: String?
    var specialties: [String]?
    var calendarColor: String?
    var bio: String?
    var isVisibleOnline: Bool?
    var isActive: Bool?
}

/// `ReplaceStaffServicesDto` — listenin **tamamını** değiştirir.
nonisolated struct ReplaceStaffServicesInput: Encodable, Sendable {
    let services: [StaffServiceSkillInput]
}
