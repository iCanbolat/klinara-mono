import Foundation

// Kaynak: `apps/api/src/modules/packages/dto/package-report.dto.ts`.
//
// **Tarih aralıkları yarı açıktır: `[from, to)`.** Ay raporu için `to` ayın
// son günü değil, ertesi ayın ilk günüdür; "son gün eksik" hatası bu ayrımın
// unutulmasından çıkar.

// MARK: - Gruplama

nonisolated enum OutstandingGrouping: String, Sendable, CaseIterable, Identifiable {
    case service
    case customer
    case branch

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .service: return "Hizmet"
        case .customer: return "Müşteri"
        case .branch: return "Şube"
        }
    }
}

nonisolated enum UsageGrouping: String, Sendable, CaseIterable, Identifiable {
    case service
    case branch

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .service: return "Hizmet"
        case .branch: return "Şube"
        }
    }
}

// MARK: - Taşınan yükümlülük

/// `OutstandingRowDto`.
nonisolated struct OutstandingRow: Decodable, Sendable, Identifiable, Equatable {
    /// Gruplama kırılımı silinmiş bir kayda düşerse `nil` gelebilir.
    let groupId: String?
    let groupLabel: String
    let packages: Int
    let remainingSessions: Int
    /// Satış anındaki tahsisten hesaplanan yükümlülük (kuruş).
    let outstandingMinor: Int

    var id: String { groupId ?? groupLabel }
}

nonisolated struct OutstandingTotals: Decodable, Sendable, Equatable {
    let packages: Int
    let remainingSessions: Int
    let outstandingMinor: Int
    let currency: String
}

/// `GET /reports/packages/outstanding` — kliniğin taşıdığı borç.
nonisolated struct OutstandingReport: Decodable, Sendable, Equatable {
    let totals: OutstandingTotals
    let data: [OutstandingRow]
}

// MARK: - Yaklaşan süre dolumu

/// `ExpiringRowDto`.
nonisolated struct ExpiringRow: Decodable, Sendable, Identifiable, Equatable {
    let customerPackageId: String
    let customerId: String
    let customerName: String
    let packageName: String
    let branchId: String
    let remainingSessions: Int
    let expiresAt: Date
    /// Yalnız `report.revenue:read` izniyle dolu gelir. İzin yoksa `nil`'dir
    /// ve ekranda "—" yazılır — sıfır yazmak taşınmayan bir borç iddiasıdır.
    let outstandingMinor: Int?

    var id: String { customerPackageId }
}

/// `GET /reports/packages/expiring` — cursor sayfalamalı.
nonisolated struct ExpiringReport: Decodable, Sendable, Equatable {
    let data: [ExpiringRow]
    let pageInfo: PageInfo
}

// MARK: - Dönem kullanımı

/// `UsageRowDto` — defterden hesaplanır, ters kayıtlar toplamdan düşülmüştür.
nonisolated struct UsageRow: Decodable, Sendable, Identifiable, Equatable {
    let groupId: String?
    let groupLabel: String
    let purchased: Int
    let consumed: Int
    let refunded: Int
    let expired: Int
    let transferred: Int
    let adjusted: Int

    var id: String { groupId ?? groupLabel }
}

/// `GET /reports/packages/usage`.
nonisolated struct UsageReport: Decodable, Sendable, Equatable {
    let data: [UsageRow]
}
