import Foundation

// Kaynak: `apps/api/src/modules/reporting/dto/report.dto.ts` ve
// `packages/shared/src/reports-api.ts`.
//
// **Tarih aralıkları yarı açıktır: `[from, to)`.** Ay raporunda `to` ayın son
// günü değil, ertesi ayın ilk günüdür.
//
// ⚠️ HİÇBİR SAYI BURADA HESAPLANMIYOR. Oranlar, toplamlar ve yüzde değişimler
// sunucudan geldiği gibi taşınıyor — Faz 5 ve 6'daki "bakiye istemcide
// hesaplanmaz" kuralının aynısı. Yerelde ikinci bir toplam tutmak, senkron
// kalması gereken üçüncü bir gerçek kaynağı yaratırdı.

// MARK: - Ortak

/// Yanıtın kapsamı.
///
/// `own`, sunucunun çağıranı kendi personel satırına KİLİTLEDİĞİ anlamına
/// gelir. İstemci bunu izin listesine bakıp tahmin ETMİYOR; sunucudan okuyor.
/// İki taraf kuralı ayrı yorumlasaydı, sunucu daraltırken uygulama "tüm klinik"
/// diye başlık atan bir rapor gösterebilirdi.
nonisolated enum ReportScopeKind: String, Decodable, Sendable {
    case all
    case own
}

nonisolated struct ReportPeriod: Decodable, Sendable, Equatable {
    let from: String
    /// HARİÇ.
    let to: String
}

/// Yüzde değişim. `nil` **kıyaslanamaz** demek (önceki dönem sıfır), `0` değil.
typealias ReportDelta = [String: Double?]

// MARK: - Doluluk

nonisolated enum OccupancyGrouping: String, Sendable, CaseIterable, Identifiable {
    case staff
    case branch
    case day

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .staff: return "Personel"
        case .branch: return "Şube"
        case .day: return "Gün"
        }
    }
}

nonisolated struct OccupancyTotals: Decodable, Sendable, Equatable {
    let bookedMinutes: Int
    let availableMinutes: Int
    /// Yüzde. Mesai dışı randevu varsa 100'ü **aşabilir**.
    let occupancyRate: Double
}

nonisolated struct OccupancyRow: Decodable, Sendable, Identifiable, Equatable {
    /// Gün kırılımında `nil`: yerel tarih bir kimlik değil, etiketin kendisi.
    let groupId: String?
    let groupLabel: String
    let bookedMinutes: Int
    let availableMinutes: Int
    let occupancyRate: Double

    var id: String { groupId ?? groupLabel }
}

nonisolated struct OccupancyReport: Decodable, Sendable, Equatable {
    let scope: ReportScopeKind
    let period: ReportPeriod
    let totals: OccupancyTotals
    let data: [OccupancyRow]
    let previous: OccupancyTotals?
    let delta: ReportDelta?
}

// MARK: - Ciro

nonisolated enum RevenueGrouping: String, Sendable, CaseIterable, Identifiable {
    case service
    case package
    case staff
    case branch
    case day
    case method

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .service: return "Hizmet"
        case .package: return "Paket"
        case .staff: return "Personel"
        case .branch: return "Şube"
        case .day: return "Gün"
        case .method: return "Ödeme yöntemi"
        }
    }
}

nonisolated struct RevenueTotals: Decodable, Sendable, Equatable {
    /// Pencerede AÇILAN ücret kalemleri (kuruş).
    let accruedMinor: Int
    /// Pencerede YAPILAN, iptal edilmemiş tahsilatlar (kuruş).
    let collectedMinor: Int
    let refundedMinor: Int
    let currency: String
}

nonisolated struct RevenueRow: Decodable, Sendable, Identifiable, Equatable {
    let groupId: String?
    let groupLabel: String
    let accruedMinor: Int
    let collectedMinor: Int

    var id: String { groupId ?? groupLabel }
}

/// ⚠️ `data` satırlarının tahsilat toplamı `totals.collectedMinor`DAN küçük
/// olabilir ve bu bir hata değil: eski bir borca bu dönemde yapılan tahsilatın
/// bağlanacağı kalem pencerede değildir. Ekran toplamı `totals`tan okuyor,
/// satırları toplayarak değil.
nonisolated struct RevenueReport: Decodable, Sendable, Equatable {
    let scope: ReportScopeKind
    let period: ReportPeriod
    let totals: RevenueTotals
    let data: [RevenueRow]
    let previous: RevenueTotals?
    let delta: ReportDelta?
}

// MARK: - Personel performansı

nonisolated struct StaffPerformanceRow: Decodable, Sendable, Identifiable, Equatable {
    let staffProfileId: String
    let staffName: String
    let completedServices: Int
    let revenueMinor: Int
    /// Ters kayıtlar düşülmüş NET tahakkuk.
    let commissionMinor: Int
    let bookedMinutes: Int
    let availableMinutes: Int
    let occupancyRate: Double

    var id: String { staffProfileId }
}

nonisolated struct StaffPerformanceReport: Decodable, Sendable, Equatable {
    let scope: ReportScopeKind
    let period: ReportPeriod
    let data: [StaffPerformanceRow]
    let currency: String
}

// MARK: - Gelmeme ve iptal

nonisolated enum NoShowGrouping: String, Sendable, CaseIterable, Identifiable {
    case staff
    case branch
    case service
    case day

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .staff: return "Personel"
        case .branch: return "Şube"
        case .service: return "Hizmet"
        case .day: return "Gün"
        }
    }
}

nonisolated struct NoShowTotals: Decodable, Sendable, Equatable {
    let total: Int
    let completed: Int
    let noShow: Int
    let cancelled: Int
    let noShowRate: Double
    let cancellationRate: Double
}

nonisolated struct NoShowRow: Decodable, Sendable, Identifiable, Equatable {
    let groupId: String?
    let groupLabel: String
    let total: Int
    let completed: Int
    let noShow: Int
    let cancelled: Int
    let noShowRate: Double
    let cancellationRate: Double

    var id: String { groupId ?? groupLabel }
}

nonisolated struct NoShowByOrigin: Decodable, Sendable, Identifiable, Equatable {
    let origin: String
    let total: Int
    let completed: Int
    let noShow: Int
    let cancelled: Int
    let noShowRate: Double
    let cancellationRate: Double

    var id: String { origin }

    var turkishName: String { origin == "online" ? "Online" : "Klinikten" }
}

nonisolated struct NoShowReport: Decodable, Sendable, Equatable {
    let period: ReportPeriod
    let totals: NoShowTotals
    let data: [NoShowRow]
    let byOrigin: [NoShowByOrigin]
    let previous: NoShowTotals?
    let delta: ReportDelta?
}

// MARK: - Kazanım ve geri dönüş

nonisolated struct AcquisitionRow: Decodable, Sendable, Identifiable, Equatable {
    /// `customers.source`; girilmemişse `nil`.
    let source: String?
    let customers: Int

    var id: String { source ?? "__unknown__" }

    var turkishName: String { source ?? "Belirtilmemiş" }
}

nonisolated struct RetentionTotals: Decodable, Sendable, Equatable {
    /// Penceredeki İLK tamamlanmış randevusu olan müşteriler.
    let newCustomers: Int
    let returningCustomers: Int
    let activeCustomers: Int
    let returningRate: Double
}

nonisolated struct CohortReturn: Decodable, Sendable, Identifiable, Equatable {
    let withinDays: Int
    let returned: Int
    let rate: Double

    var id: Int { withinDays }
}

/// ⚠️ `cohorts` oranları dönem bugüne yakınsa yapısal olarak düşük çıkar:
/// müşterilerin 90 günü henüz dolmamıştır. Sunucu bunu "düzeltmiyor" (kohortu
/// kırpmak sayının anlamını gizlerdi); ekran uyarıyı gösteriyor.
nonisolated struct RetentionReport: Decodable, Sendable, Equatable {
    let period: ReportPeriod
    let totals: RetentionTotals
    let acquisition: [AcquisitionRow]
    let cohorts: [CohortReturn]
    let previous: RetentionTotals?
    let delta: ReportDelta?
}
