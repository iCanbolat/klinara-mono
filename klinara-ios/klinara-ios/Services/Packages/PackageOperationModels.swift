import Foundation

// Kaynak: `apps/api/src/modules/packages/dto/package-operation.dto.ts`.
//
// Bu dosyadaki gövdelerin üçü (`adjust`, `refund`, `transfer`) hem `If-Match`
// hem `Idempotency-Key` ister ve bu KASITLI: ilki "bayat durum üzerinde işlem
// yaptın"ı, ikincisi "aynı isteği tekrar gönderdin"i durdurur. Biri diğerinin
// yerini tutmaz.

// MARK: - Kullanılabilir haklar

/// `PackageEntitlementDto` — randevu ekranının paket seçimi için.
///
/// Sunucu yalnız **aktif, süresi dolmamış ve kalanı olan** kalemleri döner;
/// istemcinin ayrıca elemesi gerekmez.
nonisolated struct PackageEntitlement: Decodable, Sendable, Identifiable, Equatable {
    let customerPackageItemId: String
    let customerPackageId: String
    let packageName: String
    let serviceId: String
    let serviceName: String
    let remainingSessions: Int
    let expiresAt: Date?
    let branchId: String

    /// Liste kimliği kalem kimliğidir: bir müşteride aynı hizmetin iki ayrı
    /// paketten hakkı olabilir, paket kimliği tekil olmazdı.
    var id: String { customerPackageItemId }
}

// MARK: - Düzeltme

nonisolated struct AdjustItemInput: Encodable, Sendable, Equatable {
    let customerPackageItemId: String
    /// Pozitif = hak ekle, negatif = hak düş. **Sıfır olamaz.**
    let delta: Int
}

/// `AdjustPackageDto` — gerekçe ZORUNLU, sunucu ve veritabanı da zorluyor.
nonisolated struct AdjustPackageInput: Encodable, Sendable, Equatable {
    let items: [AdjustItemInput]
    let reason: String

    /// Sunucudaki `@MinLength(5)` kuralının aynası — kullanıcıya `422` yerine
    /// pasif bir Kaydet düğmesi göstermek için.
    static let minimumReasonLength = 5

    var isValid: Bool {
        !items.isEmpty
            && items.allSatisfy { $0.delta != 0 }
            && reason.trimmingCharacters(in: .whitespacesAndNewlines).count
                >= Self.minimumReasonLength
    }
}

// MARK: - İade

nonisolated struct RefundItemInput: Encodable, Sendable, Equatable {
    let customerPackageItemId: String
    /// İade edilecek seans sayısı, en az 1.
    let sessions: Int
}

/// `RefundPackageDto` — `items` verilmezse TÜM kalan hak iade edilir.
nonisolated struct RefundPackageInput: Encodable, Sendable, Equatable {
    var items: [RefundItemInput]?
    let reason: String

    var isValid: Bool {
        let hasValidItems = items.map { !$0.isEmpty && $0.allSatisfy { $0.sessions > 0 } } ?? true
        return hasValidItems
            && reason.trimmingCharacters(in: .whitespacesAndNewlines).count
                >= AdjustPackageInput.minimumReasonLength
    }
}

/// `RefundResultDto`.
///
/// **Kasa hareketi yoktur.** Tutar satış anındaki tahsisten hesaplanır ve
/// yükümlülük `pending` yazılır; tahsilat tarafı Batch 6.2'de bağlanacak.
nonisolated struct RefundResult: Decodable, Sendable, Equatable {
    let refundedSessions: Int
    let refundAmountMinor: Int
    /// `pending` ya da `settled`.
    let settlementStatus: String
}

// MARK: - Devir

nonisolated struct TransferItemInput: Encodable, Sendable, Equatable {
    let customerPackageItemId: String
    let sessions: Int
}

/// `TransferPackageDto` — `items` verilmezse tüm kalan hak devredilir.
nonisolated struct TransferPackageInput: Encodable, Sendable, Equatable {
    let targetCustomerId: String
    var items: [TransferItemInput]?
    let reason: String

    var isValid: Bool {
        let hasValidItems = items.map { !$0.isEmpty && $0.allSatisfy { $0.sessions > 0 } } ?? true
        return !targetCustomerId.isEmpty
            && hasValidItems
            && reason.trimmingCharacters(in: .whitespacesAndNewlines).count
                >= AdjustPackageInput.minimumReasonLength
    }
}

// MARK: - Tüketim

nonisolated struct ConsumePackageLineInput: Encodable, Sendable, Equatable {
    /// Randevunun hizmet kalemi (`AppointmentService.id`).
    let appointmentServiceId: String
    /// Düşülecek müşteri paketi kalemi.
    let customerPackageItemId: String
}

/// `ConsumePackageDto` — randevu kalemlerini pakete bağlar.
nonisolated struct ConsumePackageInput: Encodable, Sendable, Equatable {
    let lines: [ConsumePackageLineInput]
}

/// `ConsumePackageResultDto`.
///
/// `consumed` randevu **henüz `completed` değilse 0**'dır ve bu bir hata
/// değildir: bağlama yapıldı, düşme randevu tamamlandığında aynı transaction
/// içinde kendiliğinden olacak.
nonisolated struct ConsumePackageResult: Decodable, Sendable, Equatable {
    let bound: Int
    let consumed: Int
}
