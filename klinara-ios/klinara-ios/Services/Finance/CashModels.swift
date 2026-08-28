import Foundation

// Kaynak: `apps/api/src/modules/finance/dto/cash.dto.ts`.
//
// **Kasa oturumunda `status` kolonu YOK** (Ek K kararı); açıklık sunucuda
// `closed_at is null` ile türetiliyor ve yanıt DTO'su bunu `status` alanı
// olarak yansıtıyor. İstemci de `closedAt`'e değil bu alana bakar — iki ayrı
// gerçek üretmemek için.

// MARK: - Durum

/// Kasa oturumunun açık/kapalı durumu — iki değerli **kapalı** küme.
nonisolated enum CashSessionStatus: String, Codable, Sendable, CaseIterable, Identifiable {
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

/// `cash_movement_kind`.
///
/// ``unknown`` kolu **var**: `payout` ve `deposit` sunucuda tanımlı ama uçları
/// açılmadı (Ek K devreden madde) ve küme büyümeye açık. Bilinmeyen bir hareket
/// dökümü hiç açılamaz hâle getirmemeli.
nonisolated enum CashMovementKind: String, Decodable, Sendable, CaseIterable {
    case opening
    case payment
    case refund
    case payout
    case deposit
    case unknown

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = CashMovementKind(rawValue: raw) ?? .unknown
    }

    var turkishName: String {
        switch self {
        case .opening: return "Açılış"
        case .payment: return "Tahsilat"
        case .refund: return "İade"
        case .payout: return "Para çıkışı"
        case .deposit: return "Para girişi"
        case .unknown: return "Bilinmeyen hareket"
        }
    }

    var icon: String {
        switch self {
        case .opening: return "tray"
        case .payment: return "arrow.down.left"
        case .refund: return "arrow.uturn.backward"
        case .payout: return "arrow.up.right"
        case .deposit: return "arrow.down.right"
        case .unknown: return "questionmark.circle"
        }
    }
}

/// `REFUND_KINDS`. Kapalı küme: sunucu bu üçünü doğruluyor ve yeni bir tür
/// gövde doğrulamasını değiştirmek demek — sessizce yorumlanamaz.
nonisolated enum RefundKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case package
    case service
    case other

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .package: return "Paket iadesi"
        case .service: return "Hizmet iadesi"
        case .other: return "Diğer"
        }
    }
}

// MARK: - Kasa oturumu

/// `CashSessionResponseDto`.
nonisolated struct CashSession: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let branchId: String
    let status: CashSessionStatus
    let openingBalanceMinor: Int
    let openedAt: Date
    let closedAt: Date?
    /// **Kapanışta** hesaplanır; açık oturumda `nil` gelir. Özet ucu açık
    /// oturum için de bir `expectedMinor` döndürür — ikisini karıştırmamak
    /// gerekir, buradaki kapanış anındaki dondurulmuş değerdir.
    let expectedMinor: Int?
    let countedMinor: Int?
    let differenceMinor: Int?
    let differenceReason: String?
    let currency: String
    let version: Int

    var isOpen: Bool { status == .open }

    /// Kapanışta sayım tutmadı mı — rozet buna bakar.
    var hasDifference: Bool { (differenceMinor ?? 0) != 0 }
}

/// `CashMovementDto` — append-only kasa hareketi.
nonisolated struct CashMovement: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let kind: CashMovementKind
    /// Giriş pozitif, çıkış negatif.
    let amountMinor: Int
    let paymentId: String?
    let refundId: String?
    let note: String?
    let createdAt: Date
}

/// `CashSessionSummaryDto.byMethod` satırı.
nonisolated struct CashMethodTotal: Decodable, Sendable, Identifiable, Equatable {
    let method: PaymentMethod
    let amountMinor: Int
    let count: Int

    var id: String { method.rawValue }
}

/// `CashSessionSummaryDto`.
nonisolated struct CashSessionSummary: Decodable, Sendable, Equatable {
    let session: CashSession
    /// Açılış + nakit hareketler. Kapanışta çekmecede olması **beklenen** tutar.
    let expectedMinor: Int
    /// Oturumdaki tüm tahsilatların yöntem kırılımı — nakit dışı yöntemler de
    /// burada; beklenen tutara yalnız nakit girer.
    let byMethod: [CashMethodTotal]
    let movements: [CashMovement]

    /// Sayım girildiğinde oluşacak fark. Sunucu da aynı çıkarmayı yapıyor;
    /// kullanıcıya kapatmadan ÖNCE göstermek 422'ye göndermekten iyidir.
    func difference(counted: Int) -> Int { counted - expectedMinor }
}

/// `RefundResponseDto`.
nonisolated struct Refund: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let customerId: String
    let kind: RefundKind
    /// **Pozitif** tutar — yön `kind` ile belli.
    let amountMinor: Int
    let method: PaymentMethod
    let chargeId: String?
    let customerPackageId: String?
    let cashSessionId: String?
    let reason: String
    let refundedAt: Date
    /// Paket iadesinde `settled`e çekilen mutabakat durumu.
    let packageSettlementStatus: String?
}

// MARK: - Gövdeler

/// `OpenCashSessionDto`. `X-Branch-Id` zorunludur, gövdede yok.
nonisolated struct OpenCashSessionInput: Encodable, Sendable, Equatable {
    var openingBalanceMinor: Int?
}

/// `CloseCashSessionDto`. Fark varsa `differenceReason` **zorunlu**.
nonisolated struct CloseCashSessionInput: Encodable, Sendable, Equatable {
    let countedMinor: Int
    var differenceReason: String?
}

/// `CreateRefundDto`.
///
/// Paket iadesi `POST /customer-packages/:id/refund` (Faz 5) ile yapılır ve
/// borç kalemini o akış üretir; bu uç **kasa hareketini** yazar. Karıştırmamak
/// için iade sheet'i hizmet/diğer içindir.
nonisolated struct CreateRefundInput: Encodable, Sendable, Equatable {
    let customerId: String
    let kind: RefundKind
    /// Pozitif tutar (kuruş).
    let amountMinor: Int
    let method: PaymentMethod
    /// Kapatılacak negatif ücret kalemi.
    var chargeId: String?
    /// Paket iadesinde zorunlu.
    var customerPackageId: String?
    /// Nakit iadede zorunlu.
    var cashSessionId: String?
    let reason: String
}
