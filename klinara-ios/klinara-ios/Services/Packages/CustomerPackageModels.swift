import Foundation

// Kaynak: `apps/api/src/modules/packages/dto/customer-package.dto.ts`.
// Alan adları sunucudakiyle birebir; `CodingKeys` eşlemesi yok.
//
// **Kalan hak defterden türetilir.** `remainingSessions` sunucuda trigger'la
// tutulan bir yansımadır; istemci onu okur ama kendi başına HESAPLAMAZ —
// yerelde toplayıp yazmak, defterin tek otorite olduğu kuralını bozardı.

// MARK: - Durum

/// `CUSTOMER_PACKAGE_STATUSES`.
nonisolated enum CustomerPackageStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case active
    case expired
    case refunded
    case transferred

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .active: return "Aktif"
        case .expired: return "Süresi doldu"
        case .refunded: return "İade edildi"
        case .transferred: return "Devredildi"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .active: return .positive
        case .expired: return .warning
        case .refunded, .transferred: return .muted
        }
    }

    /// Yalnız aktif pakette tüketim, iade ve devir yapılabilir.
    var isOpen: Bool { self == .active }
}

/// `ledger_entry_type` — defter satırının cinsi.
///
/// ``unknown`` kolu **zorunlu**: sunucu yeni bir tür eklediğinde eski istemci
/// çözümlemede patlarsa paket detayı hiç açılamaz. Bilinmeyen satır sessizce
/// yutulmuyor da; deltasıyla birlikte "bu sürümde adlandırılamayan işlem"
/// olarak çiziliyor ki eksik bir defter tam görünmesin.
nonisolated enum LedgerEntryType: String, Decodable, Sendable {
    case purchase
    case consume
    case refund
    case transferIn = "transfer_in"
    case transferOut = "transfer_out"
    case expire
    case manualAdjustment = "manual_adjustment"
    case unknown

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LedgerEntryType(rawValue: raw) ?? .unknown
    }

    var turkishName: String {
        switch self {
        case .purchase: return "Satış"
        case .consume: return "Kullanım"
        case .refund: return "İade"
        case .transferIn: return "Devir (gelen)"
        case .transferOut: return "Devir (giden)"
        case .expire: return "Süre dolumu"
        case .manualAdjustment: return "Manuel düzeltme"
        case .unknown: return "Bilinmeyen işlem"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .purchase, .transferIn: return .positive
        case .consume: return .neutral
        case .refund, .expire, .transferOut: return .warning
        case .manualAdjustment, .unknown: return .muted
        }
    }

    var icon: String {
        switch self {
        case .purchase: return "cart"
        case .consume: return "checkmark.circle"
        case .refund: return "arrow.uturn.backward"
        case .transferIn: return "arrow.down.circle"
        case .transferOut: return "arrow.up.circle"
        case .expire: return "hourglass"
        case .manualAdjustment: return "slider.horizontal.3"
        case .unknown: return "questionmark.circle"
        }
    }
}

// MARK: - Kalem

/// `CustomerPackageItemResponseDto`.
///
/// **Bakiye kalem bazındadır.** 10 lazer + 2 bakım satılan bir pakette tek bir
/// "kalan 12" sayacı 12 seansın hepsinin lazer olarak tüketilmesine izin
/// verirdi; ekran da bu yüzden kalemleri ayrı ayrı gösterir.
nonisolated struct CustomerPackageItem: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let serviceId: String
    /// Satış anındaki hizmet adı (snapshot) — katalogda ad değişse bile
    /// müşterinin aldığı paket ne yazıyorsa o görünür.
    let serviceName: String
    let quantityTotal: Int
    let remainingSessions: Int
    /// Satış anındaki katalog birim fiyatı — yalnız gösterim.
    let unitListPriceMinor: Int
    /// Satış tutarının bu kaleme tahsis edilen payı. Yükümlülük ve iade
    /// matematiği DAİMA buradan türetilir.
    let itemTotalMinor: Int
    /// Kalan hakkın parasal karşılığı.
    let outstandingMinor: Int
    let sortOrder: Int

    var usedSessions: Int { max(0, quantityTotal - remainingSessions) }

    /// Kullanım oranı (0…1) — ilerleme çubuğu için. Sıfır adetli kalem olmaz
    /// ama sunucuya güvenip sıfıra bölmüyoruz.
    var usedFraction: Double {
        guard quantityTotal > 0 else { return 0 }
        return Double(usedSessions) / Double(quantityTotal)
    }
}

// MARK: - Müşteri paketi

/// `CustomerPackageResponseDto` — satılmış paket (Batch 5.2).
nonisolated struct CustomerPackage: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let customerId: String
    let branchId: String
    /// Tanım arşivlenmişse `nil` olabilir — satış izi tanımdan bağımsız yaşar.
    let definitionId: String?
    /// Satış anındaki paket adı (snapshot).
    let name: String
    let definitionRevision: Int
    let totalPriceMinor: Int
    let currency: String
    let isTransferable: Bool
    let validityDays: Int?
    let soldAt: Date
    /// `nil` süresiz paket demektir.
    let expiresAt: Date?
    let status: CustomerPackageStatus
    /// Kalemlerin toplamı.
    let remainingSessions: Int
    let outstandingMinor: Int
    let refundedSessions: Int
    let refundAmountMinor: Int
    /// `pending` = borç doğdu, kasa hareketi Faz 6.2'de bağlanacak.
    let refundSettlementStatus: String?
    let refundedAt: Date?
    let refundReason: String?
    let transferredFromPackageId: String?
    let note: String?
    /// `If-Match` için optimistic locking sayacı.
    let version: Int
    let items: [CustomerPackageItem]
    let createdAt: Date
}

extension CustomerPackage {

    var totalSessions: Int { items.reduce(0) { $0 + $1.quantityTotal } }

    /// Süresi dolmak üzere mi — eşik varsayılanı bir aydır (yaklaşan süre
    /// dolumu raporunun mantığıyla aynı, ama burada tek kayıt için).
    func expiresSoon(within days: Int = 30, now: Date = Date()) -> Bool {
        guard status == .active, remainingSessions > 0, let expiresAt else { return false }
        guard expiresAt > now else { return false }
        return expiresAt <= now.addingTimeInterval(TimeInterval(days) * 86_400)
    }

    /// Süresi geçmiş ama durumu henüz `expired`a çevrilmemiş olabilir: kapatma
    /// bir cron job'ıyla yapılıyor. Ekran tarihe bakar, yalnız duruma değil.
    func isExpired(now: Date = Date()) -> Bool {
        if status == .expired { return true }
        guard let expiresAt else { return false }
        return expiresAt <= now
    }

    /// Kullanılabilir mi — tüketim ve devir düğmeleri buna bakar.
    func isConsumable(now: Date = Date()) -> Bool {
        status == .active && remainingSessions > 0 && !isExpired(now: now)
    }
}

// MARK: - Defter

/// `PackageLedgerEntryResponseDto` — append-only defterin bir satırı.
nonisolated struct PackageLedgerEntry: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let customerPackageItemId: String
    let serviceId: String
    let serviceName: String
    let entryType: LedgerEntryType
    /// `purchase` +10, `consume` -1.
    let delta: Int
    let appointmentId: String?
    let actorUserId: String?
    let reason: String?
    /// Dolu ise bu satır bir düzeltmedir; işaret ettiği kaydı geri alır.
    let reversesEntryId: String?
    let createdAt: Date

    var isReversal: Bool { reversesEntryId != nil }

    /// "+3" / "-1" — işaret her zaman yazılır, artı işareti de dahil.
    var signedDelta: String { delta > 0 ? "+\(delta)" : "\(delta)" }
}

// MARK: - Gövde

/// `CreateCustomerPackageDto` — satış. `X-Branch-Id` zorunludur, gövdede yok.
nonisolated struct CreateCustomerPackageInput: Encodable, Sendable, Equatable {
    let customerId: String
    let definitionId: String
    /// Verilmezse satış anı. Geçmişe dönük kayıt için.
    var soldAt: String?
    var note: String?
}
