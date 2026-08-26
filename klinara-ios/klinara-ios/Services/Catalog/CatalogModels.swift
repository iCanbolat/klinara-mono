import Foundation

// Bu dosyadaki tipler `apps/api/src/modules/catalog/dto/catalog.dto.ts`
// içindeki DTO'lardan birebir türetilmiştir. Alan adları sunucudakiyle aynıdır;
// `CodingKeys` eşlemesi YOKTUR ve olmamalıdır — bir alan adı ayrışırsa hata
// derleme anında değil çalışma anında çıkar.

// MARK: - Kategori

nonisolated struct ServiceCategory: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let slug: String
    let name: String
    let sortOrder: Int
    let isActive: Bool
    let createdAt: Date
}

/// `CreateServiceCategoryDto`.
nonisolated struct CreateServiceCategoryInput: Encodable, Sendable {
    let slug: String
    let name: String
    var sortOrder: Int?
    var isActive: Bool?
}

/// `UpdateServiceCategoryDto` — verilmeyen alan **değişmez**.
nonisolated struct UpdateServiceCategoryInput: Encodable, Sendable {
    var slug: String?
    var name: String?
    var sortOrder: Int?
    var isActive: Bool?
}

// MARK: - Şube override'ı

/// `BranchServiceOverrideResponseDto`.
///
/// Her alan opsiyoneldir ve `nil` "**hizmetin kendi değerini devral**" demektir —
/// "sıfır" ya da "kapalı" değil. Formda bu ayrımın korunması şart.
nonisolated struct BranchServiceOverride: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let serviceId: String
    let branchId: String
    let durationMinutes: Int?
    let bufferBeforeMinutes: Int?
    let bufferAfterMinutes: Int?
    let priceMinor: Int?
    let vatRateBasisPoints: Int?
    let isOnlineBookable: Bool?
    let isActive: Bool?
    let createdAt: Date
}

/// `BranchServiceOverrideInputDto`.
nonisolated struct BranchServiceOverrideInput: Encodable, Sendable, Equatable {
    let branchId: String
    var durationMinutes: Int?
    var bufferBeforeMinutes: Int?
    var bufferAfterMinutes: Int?
    var priceMinor: Int?
    var vatRateBasisPoints: Int?
    var isOnlineBookable: Bool?
    var isActive: Bool?

    /// Hiçbir alanı doldurulmamış override sunucuya gönderilmez — anlamı yok,
    /// yalnız gereksiz satır üretir.
    var isEmpty: Bool {
        durationMinutes == nil && bufferBeforeMinutes == nil && bufferAfterMinutes == nil
            && priceMinor == nil && vatRateBasisPoints == nil
            && isOnlineBookable == nil && isActive == nil
    }
}

// MARK: - Hizmet

/// `ServiceResponseDto` — kliniğin sunduğu hizmet.
///
/// Adı `Service` değil: `CatalogService` protokolüyle ve SwiftUI'nin kendi
/// isimleriyle karışırdı. Domain dilinde "hizmet" karşılığı budur.
nonisolated struct ClinicService: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let tenantId: String
    let categoryId: String
    let slug: String
    let name: String
    let description: String?
    let durationMinutes: Int
    let bufferBeforeMinutes: Int
    let bufferAfterMinutes: Int
    let priceMinor: Int
    let vatRateBasisPoints: Int
    let calendarColor: String?
    let isOnlineBookable: Bool
    let isActive: Bool
    let createdAt: Date
    let branchOverrides: [BranchServiceOverride]
}

/// `CreateServiceDto`.
nonisolated struct CreateServiceInput: Encodable, Sendable {
    let categoryId: String
    let slug: String
    let name: String
    var description: String?
    let durationMinutes: Int
    var bufferBeforeMinutes: Int?
    var bufferAfterMinutes: Int?
    let priceMinor: Int
    var vatRateBasisPoints: Int?
    var calendarColor: String?
    var isOnlineBookable: Bool?
    var isActive: Bool?
    var branchOverrides: [BranchServiceOverrideInput]?
}

/// `UpdateServiceDto`.
nonisolated struct UpdateServiceInput: Encodable, Sendable {
    var categoryId: String?
    var slug: String?
    var name: String?
    var description: String?
    var durationMinutes: Int?
    var bufferBeforeMinutes: Int?
    var bufferAfterMinutes: Int?
    var priceMinor: Int?
    var vatRateBasisPoints: Int?
    var calendarColor: String?
    var isOnlineBookable: Bool?
    var isActive: Bool?
    var branchOverrides: [BranchServiceOverrideInput]?
}

// MARK: - Şubede geçerli değerler

extension ClinicService {

    /// Bir hizmetin **belirli bir şubede** geçerli olan değerleri.
    ///
    /// Kural sunucudaki ile aynı: override'ın `nil` olmayan her alanı hizmetin
    /// kendi değerini ezer. Bu hesabın arayüzde birden çok yerde elle
    /// tekrarlanması, listeyle detayın farklı fiyat göstermesinin klasik yoludur.
    struct Effective: Sendable, Equatable {
        let durationMinutes: Int
        let bufferBeforeMinutes: Int
        let bufferAfterMinutes: Int
        let priceMinor: Int
        let vatRateBasisPoints: Int
        let isOnlineBookable: Bool
        let isActive: Bool
        /// Şubeye özel en az bir alan var mı — arayüzde rozet göstermek için.
        let isOverridden: Bool

        /// Takvimde işgal edilen toplam süre: hazırlık + işlem + temizlik.
        var occupiedMinutes: Int {
            bufferBeforeMinutes + durationMinutes + bufferAfterMinutes
        }
    }

    func override(for branchId: String?) -> BranchServiceOverride? {
        guard let branchId else { return nil }
        return branchOverrides.first { $0.branchId == branchId }
    }

    func effective(in branchId: String?) -> Effective {
        let applied = override(for: branchId)
        return Effective(
            durationMinutes: applied?.durationMinutes ?? durationMinutes,
            bufferBeforeMinutes: applied?.bufferBeforeMinutes ?? bufferBeforeMinutes,
            bufferAfterMinutes: applied?.bufferAfterMinutes ?? bufferAfterMinutes,
            priceMinor: applied?.priceMinor ?? priceMinor,
            vatRateBasisPoints: applied?.vatRateBasisPoints ?? vatRateBasisPoints,
            isOnlineBookable: applied?.isOnlineBookable ?? isOnlineBookable,
            isActive: applied?.isActive ?? isActive,
            isOverridden: applied != nil
        )
    }
}
