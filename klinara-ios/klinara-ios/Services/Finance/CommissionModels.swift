import Foundation

// Kaynak: `apps/api/src/modules/finance/dto/commission.dto.ts`.
//
// **Kural çözümünde belirsizlik yoktur** (Ek K kararı): personel bazlı override
// > kapsamlı kural > genel, sonra öncelik. Eşitlik ihtimali sunucudaki kısmi
// tekil indeksle kaldırıldı; istemci "hangi kural uygulandı" sorusunu tartışmaz.

// MARK: - Enum'lar
//
// Dördü de **kapalı** küme: hepsi kural formunda seçilen ve sunucu gövde
// doğrulamasında `IsIn` ile sınırlanan değerler. Yeni bir değer, formun da
// değişmesi gereken bir sözleşme değişikliğidir — sessizce `unknown`a düşürmek
// kullanıcıya "bilinmeyen matrah" ile bir prim kuralı gösterirdi.

nonisolated enum CommissionScope: String, Codable, Sendable, CaseIterable, Identifiable {
    case global
    case service
    case package
    case product

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .global: return "Tüm satışlar"
        case .service: return "Tek hizmet"
        case .package: return "Tek paket"
        case .product: return "Tek ürün"
        }
    }

    /// `global` dışındaki kapsamlar `scopeRefId` ister.
    var needsReference: Bool { self != .global }

    /// Tahakkuk çözümleyicisi bugün yalnız `appointment_services` üzerinden
    /// yürüyor (Ek K devreden madde): `package` ve `product` kapsamlı kurallar
    /// kaydedilir ama prim üretmez. Form bunu kullanıcıya söylemeli.
    var accruesToday: Bool { self == .global || self == .service }
}

nonisolated enum CommissionCalcKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case percent
    case fixed

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .percent: return "Yüzde"
        case .fixed: return "Sabit tutar"
        }
    }
}

nonisolated enum CommissionBasis: String, Codable, Sendable, CaseIterable, Identifiable {
    case servicePrice = "service_price"
    case netAfterDiscount = "net_after_discount"
    case collectedAmount = "collected_amount"

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .servicePrice: return "Hizmet fiyatı"
        case .netAfterDiscount: return "İndirim sonrası net"
        case .collectedAmount: return "Tahsil edilen tutar"
        }
    }

    var explanation: String {
        switch self {
        case .servicePrice: return "İndirim uygulanmadan önceki liste tutarı."
        case .netAfterDiscount: return "İndirim düşülmüş tutar."
        case .collectedAmount: return "Yalnız gerçekten tahsil edilen kısım."
        }
    }
}

nonisolated enum CommissionTrigger: String, Codable, Sendable, CaseIterable, Identifiable {
    case serviceCompleted = "service_completed"
    case paymentReceived = "payment_received"

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .serviceCompleted: return "Hizmet tamamlandığında"
        case .paymentReceived: return "Tahsilat yapıldığında"
        }
    }

    var explanation: String {
        switch self {
        case .serviceCompleted:
            return "Randevu tamamlanır tamamlanmaz prim doğar; tahsilat beklenmez."
        case .paymentReceived:
            return "Kısmi tahsilat kısmi prim üretir; tahsilat iptal edilirse ters kayıtla düşer."
        }
    }
}

nonisolated enum CommissionPeriodStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case open
    case closed

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .open: return "Açık"
        case .closed: return "Kapalı"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .open: return .positive
        case .closed: return .muted
        }
    }
}

// MARK: - Kayıtlar

/// `CommissionRuleResponseDto`.
nonisolated struct CommissionRule: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let name: String
    let scope: CommissionScope
    let scopeRefId: String?
    /// `nil` ise kural tüm personele uygulanır. Dolu olan kural, kapsamlı bir
    /// kuralı **ezer** — çözüm sırasının en üstü.
    let staffProfileId: String?
    let calcKind: CommissionCalcKind
    /// `percent` için **baz puan** (1000 = %10), `fixed` için kuruş.
    let value: Int
    let basis: CommissionBasis
    let triggerOn: CommissionTrigger
    /// Yüksek öncelik önce uygulanır.
    let priority: Int
    /// `YYYY-MM-DD` — sunucu bu alanları tarih (timestamp değil) taşıyor.
    let effectiveFrom: String?
    let effectiveTo: String?
    let isActive: Bool
    let version: Int

    /// Kullanıcıya gösterilen değer.
    var valueLabel: String {
        switch calcKind {
        case .percent: return VatRate.format(basisPoints: value)
        case .fixed: return Money.format(minor: value)
        }
    }
}

/// `CommissionAccrualResponseDto` — append-only tahakkuk.
///
/// Ters kayıtlar **negatif** tutarla görünür ve `reversesAccrualId` ile hangi
/// kaydı geri aldıklarını söyler. Kapalı bir döneme yazılamadıkları için
/// düzeltme cari döneme düşer (Ek K kararı).
nonisolated struct CommissionAccrual: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let staffProfileId: String
    let periodId: String
    let triggerOn: CommissionTrigger
    let ruleBasis: CommissionBasis
    /// Primin hesaplandığı matrah; ters kayıtta negatif.
    let basisMinor: Int
    /// Prim tutarı; ters kayıtta negatif.
    let amountMinor: Int
    let chargeId: String?
    let paymentId: String?
    let reversesAccrualId: String?
    let reason: String?
    let createdAt: Date

    var isReversal: Bool { reversesAccrualId != nil }
}

/// `CommissionPeriodResponseDto`. Uç **çıplak dizi** döner, `{ data: … }` zarfı
/// yoktur — `GET /customers/:id/package-entitlements` ile aynı istisna.
nonisolated struct CommissionPeriod: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let branchId: String
    /// `YYYY-MM-DD`.
    let startsOn: String
    let endsOn: String
    let status: CommissionPeriodStatus
    let closedAt: Date?
    let version: Int

    var isClosed: Bool { status == .closed }

    /// "2026-09-01 – 2026-09-30" yerine okunur bir aralık.
    var rangeLabel: String { "\(startsOn) – \(endsOn)" }
}

/// `CommissionReportRowDto`.
nonisolated struct CommissionReportRow: Decodable, Sendable, Identifiable, Equatable {
    let staffProfileId: String
    let staffName: String
    /// Ters kayıtlar **düşülmüş** net prim.
    let amountMinor: Int
    let accrualCount: Int

    var id: String { staffProfileId }
}

/// `CommissionReportDto`.
nonisolated struct CommissionReport: Decodable, Sendable, Equatable {
    let rows: [CommissionReportRow]
    let totalMinor: Int
    let currency: String
}

// MARK: - Gövdeler

/// `CreateCommissionRuleDto`.
nonisolated struct CreateCommissionRuleInput: Encodable, Sendable, Equatable {
    let name: String
    var scope: CommissionScope?
    var scopeRefId: String?
    var staffProfileId: String?
    let calcKind: CommissionCalcKind
    /// `percent` için baz puan, `fixed` için kuruş.
    let value: Int
    var basis: CommissionBasis?
    var triggerOn: CommissionTrigger?
    var priority: Int?
    var effectiveFrom: String?
    var effectiveTo: String?
}

/// `UpdateCommissionRuleDto` — sunucu yalnız bu beş alanı kabul ediyor.
/// Kapsam, matrah ve tetikleyici **değiştirilemez**: geçmiş tahakkuklar o
/// kurala göre doğdu, kuralın anlamını sonradan değiştirmek onları yalan yapar.
nonisolated struct UpdateCommissionRuleInput: Encodable, Sendable, Equatable {
    var name: String?
    var value: Int?
    var priority: Int?
    var effectiveTo: String?
    var isActive: Bool?
}
