import Foundation

// Bu dosyadaki tipler `apps/api/src/modules/packages/dto/package-definition.dto.ts`
// içindeki DTO'lardan birebir türetilmiştir. Alan adları sunucudakiyle aynıdır;
// `CodingKeys` eşlemesi YOKTUR ve olmamalıdır — bir alan adı ayrışırsa hata
// derleme anında değil çalışma anında çıkar.

// MARK: - Kalem

/// `PackageDefinitionItemResponseDto` — paketin bir hizmet kalemi.
///
/// `unitListPriceMinor` **katalog** birim fiyatıdır, paketin satış fiyatının
/// bu kaleme düşen payı değil. İkisi kasten ayrı: kampanyalı paketin indirimi
/// ancak liste toplamıyla satış fiyatı yan yana konunca görünür.
nonisolated struct PackageDefinitionItem: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let serviceId: String
    /// Sunucunun kataloğa join'leyip verdiği ad — istemci hizmet listesini
    /// beklemeden satırı çizebilsin diye.
    let serviceName: String
    let quantity: Int
    let unitListPriceMinor: Int
    let sortOrder: Int

    /// Bu kalemin katalog fiyatından toplam karşılığı (kuruş).
    var listTotalMinor: Int { unitListPriceMinor * quantity }
}

// MARK: - Tanım

/// `PackageDefinitionResponseDto` — satılabilir paket şablonu (Batch 5.1).
nonisolated struct PackageDefinition: Codable, Sendable, Identifiable, Equatable {
    let id: String
    /// `nil` **tüm şubeler** demektir, "şubesiz" değil.
    let branchId: String?
    let slug: String
    let name: String
    let description: String?
    /// Paketin SATIŞ fiyatı (kuruş).
    let totalPriceMinor: Int
    /// Kalemlerin GÜNCEL katalog fiyatları toplamı. Satılmış paketlerin
    /// yükümlülüğü buradan DEĞİL, satış anındaki tahsisten hesaplanır.
    let listPriceMinor: Int
    let currency: String
    /// `nil` süresiz paket demektir.
    let validityDays: Int?
    let isTransferable: Bool
    let isOnlineSellable: Bool
    let isActive: Bool
    /// Satışı etkileyen alanlar değiştikçe artar; satılan paket bu revizyonu
    /// snapshot olarak taşır.
    let revision: Int
    /// `If-Match` için optimistic locking sayacı.
    let version: Int
    let items: [PackageDefinitionItem]
    let createdAt: Date
    let updatedAt: Date
    /// Dolu ise tanım arşivlenmiş (soft delete). Listede gizlenir, satılmış
    /// paketlerin izini kesmemek için silinmez.
    let deletedAt: Date?
}

extension PackageDefinition {

    /// Satılmış paket tanımı silinemez, yalnız pasife alınır; kullanıcıya
    /// "arşiv" ile "pasif" arasındaki farkı göstermek için.
    var isArchived: Bool { deletedAt != nil }

    /// Paketteki toplam seans sayısı.
    var totalSessions: Int { items.reduce(0) { $0 + $1.quantity } }

    /// İndirim tutarı (kuruş) — liste toplamı satış fiyatından büyükse.
    /// `nil` indirim yok demektir; sıfır göstermek "indirim var ama 0₺" gibi okunurdu.
    var discountMinor: Int? {
        let diff = listPriceMinor - totalPriceMinor
        return diff > 0 ? diff : nil
    }

    /// Yüzde olarak indirim — rozet metni için, hesap için değil.
    var discountPercent: Int? {
        guard let discountMinor, listPriceMinor > 0 else { return nil }
        return Int((Double(discountMinor) / Double(listPriceMinor) * 100).rounded())
    }
}

// MARK: - Gövdeler

/// `PackageDefinitionItemInputDto`.
nonisolated struct PackageDefinitionItemInput: Encodable, Sendable, Equatable {
    let serviceId: String
    let quantity: Int
}

/// `CreatePackageDefinitionDto`.
nonisolated struct CreatePackageDefinitionInput: Encodable, Sendable, Equatable {
    let slug: String
    let name: String
    var description: String?
    let totalPriceMinor: Int
    /// Verilmezse paket tüm şubelerde satılır.
    var branchId: String?
    var validityDays: Int?
    var isTransferable: Bool?
    var isOnlineSellable: Bool?
    var isActive: Bool?
    let items: [PackageDefinitionItemInput]
}

/// `UpdatePackageDefinitionDto` — verilmeyen alan **değişmez**.
///
/// `description` ve `validityDays` üç durumludur (``Nullable``): "dokunma",
/// "şu değer" ve "temizle". `validityDays`'in temizlenmesi paketi SÜRESİZ
/// yapar; `0` göndermek aynı şey değildir, sunucu da kabul etmez.
///
/// `items` verilirse kalem listesi **tamamen** bununla değiştirilir.
nonisolated struct UpdatePackageDefinitionInput: Encodable, Sendable, Equatable {
    var name: String?
    var description: Nullable<String> = .unchanged
    var totalPriceMinor: Int?
    var validityDays: Nullable<Int> = .unchanged
    var isTransferable: Bool?
    var isOnlineSellable: Bool?
    var isActive: Bool?
    var items: [PackageDefinitionItemInput]?

    private enum CodingKeys: String, CodingKey {
        case name, description, totalPriceMinor, validityDays
        case isTransferable, isOnlineSellable, isActive, items
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(totalPriceMinor, forKey: .totalPriceMinor)
        try container.encodeIfPresent(isTransferable, forKey: .isTransferable)
        try container.encodeIfPresent(isOnlineSellable, forKey: .isOnlineSellable)
        try container.encodeIfPresent(isActive, forKey: .isActive)
        try container.encodeIfPresent(items, forKey: .items)
        try container.encode(description, forKey: .description)
        try container.encode(validityDays, forKey: .validityDays)
    }

    var isEmpty: Bool {
        name == nil && totalPriceMinor == nil && isTransferable == nil
            && isOnlineSellable == nil && isActive == nil && items == nil
            && description.isUnchanged && validityDays.isUnchanged
    }
}
