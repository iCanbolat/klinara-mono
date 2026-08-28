import Foundation

// Kaynak: `apps/api/src/modules/finance/dto/charge.dto.ts`,
// `dto/payment.dto.ts` ve `dto/discount.dto.ts`.
// Alan adları sunucudakiyle birebir; `CodingKeys` eşlemesi yok.
//
// **Bakiye istemcide hesaplanmaz.** `balanceMinor` sunucudaki
// `customer_account_entries` view'ının yansımasıdır (`sum(charges) -
// sum(payments)`); yerelde ikinci bir toplam tutmak, senkron kalması gereken
// üçüncü bir gerçek kaynağı yaratırdı — sunucu tarafındaki kararın aynısı.

// MARK: - Ücret kalemi

/// `CHARGE_SOURCES` — kalemin nereden doğduğu.
///
/// ``unknown`` kolu **zorunlu**: küme büyümeye açık. `product` bugün var ama
/// ürün kataloğu yok; yarın yeni bir kaynak eklendiğinde eski istemcinin cari
/// hesabı hiç açılamaz hâle gelmemeli. Gerekçe ``LedgerEntryType`` ile aynı.
nonisolated enum ChargeSource: String, Decodable, Sendable, CaseIterable {
    case appointmentService = "appointment_service"
    case packageSale = "package_sale"
    case packageRefund = "package_refund"
    case product
    case manual
    case unknown

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ChargeSource(rawValue: raw) ?? .unknown
    }

    /// Elle açılabilen kaynaklar. Randevu ve paket kalemleri kendi işlemlerinin
    /// transaction'ında **otomatik** doğar; kullanıcıya seçtirilemez.
    static let manuallyCreatable: [ChargeSource] = [.product, .manual]

    var turkishName: String {
        switch self {
        case .appointmentService: return "Randevu hizmeti"
        case .packageSale: return "Paket satışı"
        case .packageRefund: return "Paket iadesi"
        case .product: return "Ürün"
        case .manual: return "Elle açılan"
        case .unknown: return "Bilinmeyen kalem"
        }
    }

    var icon: String {
        switch self {
        case .appointmentService: return "calendar"
        case .packageSale: return "shippingbox"
        case .packageRefund: return "arrow.uturn.backward"
        case .product: return "bag"
        case .manual: return "pencil"
        case .unknown: return "questionmark.circle"
        }
    }
}

/// `charge_status` — iki değerli **kapalı** küme, `unknown` kolu yok.
/// Gerekçe ``CustomerPackageStatus`` ile aynı: bir kalem ya açık ya iptal;
/// üçüncü bir durum sessizce yorumlanamaz, sözleşme değişikliği demektir.
nonisolated enum ChargeStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case open
    case void

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .open: return "Açık"
        case .void: return "İptal"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .open: return .neutral
        case .void: return .muted
        }
    }
}

/// `discount_kind` — indirimin yüzde mi tutar mı olduğu.
nonisolated enum DiscountKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case percent
    case amount

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .percent: return "Yüzde"
        case .amount: return "Tutar"
        }
    }
}

/// `discount_scope`.
nonisolated enum DiscountScope: String, Codable, Sendable, CaseIterable, Identifiable {
    case all
    case service
    case package

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .all: return "Tüm satışlar"
        case .service: return "Tek hizmet"
        case .package: return "Tek paket"
        }
    }
}

/// `ChargeResponseDto` — bir borç kalemi.
///
/// **KDV fiyata dahildir** (Ek K kararı): `totalMinor` müşteriye söylenen brüt
/// tutardır, `vatMinor` onun içinden çıkarılır ve `netMinor = total - vat`.
/// İstemci bu üçlüyü yeniden hesaplamaz, olduğu gibi gösterir.
nonisolated struct Charge: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let branchId: String
    let customerId: String
    let source: ChargeSource
    let appointmentServiceId: String?
    let customerPackageId: String?
    let description: String
    let quantity: Int
    let unitListPriceMinor: Int
    let unitPriceMinor: Int
    let discountId: String?
    let discountKind: DiscountKind?
    let discountValue: Int?
    let discountMinor: Int
    let vatRateBasisPoints: Int
    /// KDV **dahil** brüt tutar.
    let totalMinor: Int
    let netMinor: Int
    let vatMinor: Int
    let currency: String
    let status: ChargeStatus
    let priceOverrideReason: String?
    let voidedAt: Date?
    let voidedReason: String?
    /// `If-Match` için iyimser kilit sayacı.
    let version: Int
    let createdAt: Date

    /// Fiyat liste fiyatının dışına çıkmış mı — gerekçe zorunluluğunun ekrandaki
    /// karşılığı. Paket kalemlerinde fark override değil, paketin kampanyasıdır;
    /// sunucudaki constraint de o kaynakları muaf tutuyor.
    var isPriceOverridden: Bool {
        guard source != .packageSale, source != .packageRefund else { return false }
        return unitPriceMinor != unitListPriceMinor
    }

    /// İade kalemi mi — paket iadesi NEGATİF tutarlı bir kalem üretir.
    var isCredit: Bool { totalMinor < 0 }
}

// MARK: - Cari hesap

/// `AccountEntryDto` — cari defterin bir satırı. Borç pozitif, alacak negatif.
nonisolated struct AccountEntry: Decodable, Sendable, Identifiable, Equatable {
    let entryId: String
    /// `charge` ya da `payment`. İki değerli kapalı küme.
    let entryKind: AccountEntryKind
    /// Kalem kaynağı (`appointment_service`) ya da tahsilat yöntemi (`cash`).
    /// Ham metin: iki farklı enum'un birleşimi, tek tipe zorlamak yanıltırdı.
    let entrySource: String
    let description: String
    /// Borç pozitif, alacak negatif.
    let amountMinor: Int
    let currency: String
    let occurredAt: Date

    var id: String { entryId }
}

nonisolated enum AccountEntryKind: String, Decodable, Sendable {
    case charge
    case payment

    var turkishName: String {
        switch self {
        case .charge: return "Borç"
        case .payment: return "Tahsilat"
        }
    }

    var icon: String {
        switch self {
        case .charge: return "arrow.up.right"
        case .payment: return "arrow.down.left"
        }
    }
}

/// `CustomerAccountDto` — müşterinin cari hesabı.
nonisolated struct CustomerAccount: Decodable, Sendable, Equatable {
    let customerId: String
    /// Toplam borç (açık kalemler).
    let chargedMinor: Int
    let paidMinor: Int
    /// `chargedMinor - paidMinor`. Pozitif = müşteri borçlu.
    let balanceMinor: Int
    let currency: String
    let entries: [AccountEntry]
    let pageInfo: PageInfo

    var isSettled: Bool { balanceMinor == 0 }
    /// Negatif bakiye = müşterinin avansı var.
    var hasCredit: Bool { balanceMinor < 0 }
}

// MARK: - Tahsilat

/// `PAYMENT_METHODS` — beş değerli **kapalı** küme.
nonisolated enum PaymentMethod: String, Codable, Sendable, CaseIterable, Identifiable {
    case cash
    case card
    case bankTransfer = "bank_transfer"
    case giftVoucher = "gift_voucher"
    case other

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .cash: return "Nakit"
        case .card: return "Kart"
        case .bankTransfer: return "Havale"
        case .giftVoucher: return "Hediye çeki"
        case .other: return "Diğer"
        }
    }

    var icon: String {
        switch self {
        case .cash: return "banknote"
        case .card: return "creditcard"
        case .bankTransfer: return "arrow.left.arrow.right"
        case .giftVoucher: return "giftcard"
        case .other: return "ellipsis.circle"
        }
    }

    /// Nakit işlem açık bir kasa oturumuna bağlanmadan yazılamaz (Batch 6.3).
    var requiresCashSession: Bool { self == .cash }
}

/// `payment_status` — kapalı küme.
nonisolated enum PaymentStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case posted
    case void

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .posted: return "Kayıtlı"
        case .void: return "İptal"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .posted: return .positive
        case .void: return .muted
        }
    }
}

/// `PaymentAllocationDto` — tahsilatın bir kaleme düşen payı.
nonisolated struct PaymentAllocation: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let chargeId: String
    let amountMinor: Int
    let chargeDescription: String
}

/// `PaymentResponseDto`.
nonisolated struct Payment: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let branchId: String
    let customerId: String
    let method: PaymentMethod
    let amountMinor: Int
    /// Kalemlere dağıtılmış tutar.
    let allocatedMinor: Int
    /// `amountMinor - allocatedMinor`; avans olarak durur.
    let unallocatedMinor: Int
    let currency: String
    /// Kiracı bazlı, **boşluksuz** artan makbuz numarası.
    let receiptNo: Int
    let paidAt: Date
    let cashSessionId: String?
    let note: String?
    let status: PaymentStatus
    let voidedAt: Date?
    let voidedReason: String?
    let allocations: [PaymentAllocation]
    let version: Int
    let createdAt: Date

    var hasAdvance: Bool { unallocatedMinor > 0 }
}

// MARK: - İndirim

/// `DiscountResponseDto`. Uçlar **`service:read`/`service:write`** ile korunur:
/// indirim bir katalog tanımıdır, günlük tahsilat işlemi değil.
nonisolated struct Discount: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    /// Kampanya kodu. `nil` ise indirim yalnız elle seçilebilir.
    let code: String?
    let name: String
    let kind: DiscountKind
    /// `percent` için **baz puan** (1500 = %15), `amount` için kuruş.
    let value: Int
    let scope: DiscountScope
    let scopeRefId: String?
    let startsAt: Date?
    let endsAt: Date?
    let maxRedemptions: Int?
    let redeemedCount: Int
    let isActive: Bool
    let version: Int
    let createdAt: Date

    /// Kullanıcıya gösterilen değer: yüzde işaretiyle ya da para biçiminde.
    var valueLabel: String {
        switch kind {
        case .percent: return VatRate.format(basisPoints: value)
        case .amount: return Money.format(minor: value)
        }
    }

    /// Şu an seçilebilir mi. Sunucu da aynı kontrolü yapıyor ve geçmezse
    /// `DISCOUNT_INVALID` döner; seçiciyi önden süzmek kullanıcıyı 422'ye
    /// göndermekten iyidir.
    func isSelectable(now: Date = Date()) -> Bool {
        guard isActive else { return false }
        if let startsAt, startsAt > now { return false }
        if let endsAt, endsAt <= now { return false }
        if let maxRedemptions, redeemedCount >= maxRedemptions { return false }
        return true
    }
}

// MARK: - Gövdeler

/// `CreateChargeDto`. `X-Branch-Id` zorunludur, gövdede yok.
nonisolated struct CreateChargeInput: Encodable, Sendable, Equatable {
    let customerId: String
    /// Yalnız `product` ve `manual`.
    let source: String
    let description: String
    var quantity: Int?
    /// KDV **dahil** birim fiyat (kuruş).
    let unitPriceMinor: Int
    var unitListPriceMinor: Int?
    var discountId: String?
    var vatRateBasisPoints: Int?
    /// Liste fiyatının dışına çıkılıyorsa zorunlu (`finance.price:override`).
    var priceOverrideReason: String?
}

/// `UpdateChargeDto`. `discountId` **temizlenebilir** olmalı: kullanıcı seçtiği
/// indirimi kaldırabilmeli ve alanı hiç göndermemek eskisini bırakırdı.
nonisolated struct UpdateChargeInput: Encodable, Sendable, Equatable {
    var description: String?
    var quantity: Int?
    var unitPriceMinor: Int?
    var discountId: Nullable<String> = .unchanged
    var priceOverrideReason: String?

    private enum CodingKeys: String, CodingKey {
        case description, quantity, unitPriceMinor, discountId, priceOverrideReason
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(quantity, forKey: .quantity)
        try container.encodeIfPresent(unitPriceMinor, forKey: .unitPriceMinor)
        try container.encodeIfPresent(priceOverrideReason, forKey: .priceOverrideReason)
        switch discountId {
        case .unchanged: break
        case .set(let value): try container.encode(value, forKey: .discountId)
        case .clear: try container.encodeNil(forKey: .discountId)
        }
    }
}

nonisolated struct ReasonInput: Encodable, Sendable, Equatable {
    let reason: String
}

/// `PaymentAllocationInputDto`.
nonisolated struct PaymentAllocationInput: Encodable, Sendable, Equatable, Identifiable {
    let chargeId: String
    let amountMinor: Int

    var id: String { chargeId }
}

/// `CreatePaymentDto`. `allocations` verilmezse sunucu açık kalemlere
/// **eskiden yeniye** dağıtır ve artan tutar avans olarak kalır.
nonisolated struct CreatePaymentInput: Encodable, Sendable, Equatable {
    let customerId: String
    let method: PaymentMethod
    let amountMinor: Int
    var allocations: [PaymentAllocationInput]?
    var paidAt: String?
    /// Nakit tahsilatta zorunlu.
    var cashSessionId: String?
    var note: String?
}

/// `CreateDiscountDto`.
nonisolated struct CreateDiscountInput: Encodable, Sendable, Equatable {
    var code: String?
    let name: String
    let kind: DiscountKind
    let value: Int
    var scope: DiscountScope?
    var scopeRefId: String?
    var startsAt: String?
    var endsAt: String?
    var maxRedemptions: Int?
}

/// `UpdateDiscountDto` — sunucu yalnız bu dört alanı kabul ediyor.
nonisolated struct UpdateDiscountInput: Encodable, Sendable, Equatable {
    var name: String?
    var endsAt: String?
    var maxRedemptions: Int?
    var isActive: Bool?
}
