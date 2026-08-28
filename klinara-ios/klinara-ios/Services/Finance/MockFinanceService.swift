import Foundation

/// Sunucu olmadan finans ekranlarını sürmek için bellek-içi cari defter.
///
/// ``MockPackagesService``in defteri gerçekten tutması gibi, bu mock da
/// **davranışı** taklit eder, yalnız veriyi değil:
///
/// - Bakiye bir alan değil, `sum(open charges) - sum(posted payments)`.
/// - Tahsis verilmezse açık kalemlere **eskiden yeniye** dağıtılır, artan avans kalır.
/// - Kalem bakiyesi aşılırsa ``APIErrorCode/paymentExceedsBalance``.
/// - Nakit işlem açık kasa oturumu istemezse ``APIErrorCode/cashSessionRequired``.
/// - İkinci kasa açılışı ``APIErrorCode/cashSessionAlreadyOpen``.
/// - Makbuz numarası **boşluksuz** artar.
///
/// Mock'un bu kurallarda ayrışması, arayüzü canlıda ilk denemede yanıltırdı.
final class MockFinanceService: FinanceService, @unchecked Sendable {

    private let lock = NSLock()
    private let customers: MockCustomerService

    private var chargeRecords: [Charge] = []
    private var paymentRecords: [Payment] = []
    private var cashSessionRecords: [CashSession] = []
    /// `cashSessionId` → hareketler, eskiden yeniye.
    private var movementRecords: [String: [CashMovement]] = [:]
    private var refundRecords: [Refund] = []
    private var discountRecords: [Discount] = []
    /// `Idempotency-Key` → üretilen kaydın kimliği.
    private var idempotency: [String: String] = [:]
    /// Boşluksuz makbuz sayacı — sunucudaki `next_receipt_no()` karşılığı.
    private var receiptCounter = MockFinanceSeed.firstReceiptNo

    /// Prim mock'u tahsilat iptalinde ters tahakkuk yazabilsin diye bağlanır.
    /// Kurucu yerine sonradan verilmesinin sebebi döngüsel bağımlılık: prim
    /// mock'u da bu servisin kalemlerini okuyor.
    weak var commissions: MockCommissionsService?

    init(customers: MockCustomerService) {
        self.customers = customers
        seed()
    }

    func reseed() {
        withLock { seed() }
    }

    private func seed() {
        let now = Date()
        chargeRecords = MockFinanceSeed.charges(at: now)
        paymentRecords = MockFinanceSeed.payments(at: now)
        cashSessionRecords = MockFinanceSeed.cashSessions(at: now)
        movementRecords = MockFinanceSeed.cashMovements(at: now)
        discountRecords = MockFinanceSeed.discounts(at: now)
        refundRecords = []
        idempotency = [:]
        receiptCounter = MockFinanceSeed.firstReceiptNo
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    /// Testlerin ve prim mock'unun okuyabilmesi için anlık kopya.
    var snapshotCharges: [Charge] { withLock { chargeRecords } }
    var snapshotPayments: [Payment] { withLock { paymentRecords } }

    // MARK: Hatalar

    private func notFound() -> APIError {
        .problem(ProblemDetails(code: .notFound, title: "Bulunamadı", status: 404))
    }

    private func versionConflict() -> APIError {
        .problem(ProblemDetails(
            code: .versionConflict,
            title: "Sürüm çakışması",
            detail: "Kayıt siz düzenlerken değişti",
            status: 409
        ))
    }

    private func validation(_ detail: String) -> APIError {
        .problem(ProblemDetails(code: .validationFailed, title: "Geçersiz istek", detail: detail, status: 422))
    }

    private func exceedsBalance(_ detail: String) -> APIError {
        .problem(ProblemDetails(
            code: .paymentExceedsBalance,
            title: "Tutar bakiyeyi aşıyor",
            detail: detail,
            status: 409
        ))
    }

    private func cashRequired() -> APIError {
        .problem(ProblemDetails(
            code: .cashSessionRequired,
            title: "Kasa oturumu gerekli",
            detail: "Nakit işlem açık bir kasa oturumuna bağlanmalı",
            status: 409
        ))
    }

    private func cashAlreadyOpen() -> APIError {
        .problem(ProblemDetails(
            code: .cashSessionAlreadyOpen,
            title: "Kasa zaten açık",
            detail: "Bu şubede açık bir kasa oturumu var",
            status: 409
        ))
    }

    private func discountInvalid() -> APIError {
        .problem(ProblemDetails(
            code: .discountInvalid,
            title: "İndirim geçersiz",
            detail: "İndirim süresi dolmuş, pasif ya da hakkı tükenmiş",
            status: 409
        ))
    }

    // MARK: Bakiye — tek hesap noktası

    /// Bir kaleme şu ana kadar tahsis edilmiş toplam. `void` tahsilatların
    /// tahsisleri sayılmaz; satırlar silinmez ama bakiye geri gelir.
    private func allocated(to chargeId: String) -> Int {
        paymentRecords
            .filter { $0.status == .posted }
            .flatMap(\.allocations)
            .filter { $0.chargeId == chargeId }
            .reduce(0) { $0 + $1.amountMinor }
    }

    private func openBalance(of charge: Charge) -> Int {
        max(0, charge.totalMinor - allocated(to: charge.id))
    }

    /// Açık kalemler, **eskiden yeniye** — otomatik dağıtımın sırası budur.
    /// Sıralama tahsis satırının değil, KALEMİN yaşına göre (Ek K, bulgu #5).
    private func openCharges(for customerId: String) -> [Charge] {
        chargeRecords
            .filter { $0.customerId == customerId && $0.status == .open }
            .filter { openBalance(of: $0) > 0 }
            .sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: Ücret kalemleri

    func createCharge(_ input: CreateChargeInput, idempotencyKey: String?) async throws -> Charge {
        await latency()
        return try withLock {
            if let key = idempotencyKey, let existing = idempotency[key],
               let found = chargeRecords.first(where: { $0.id == existing }) {
                return found
            }
            guard let source = ChargeSource(rawValue: input.source),
                  ChargeSource.manuallyCreatable.contains(source)
            else { throw validation("Bu kaynak elle açılamaz") }

            let quantity = input.quantity ?? 1
            let listPrice = input.unitListPriceMinor ?? input.unitPriceMinor
            if input.unitPriceMinor != listPrice, input.priceOverrideReason == nil {
                throw validation("Liste fiyatının dışına çıkılıyorsa gerekçe zorunlu")
            }

            var discountMinor = 0
            var kind: DiscountKind?
            var value: Int?
            if let discountId = input.discountId {
                guard let discount = discountRecords.first(where: { $0.id == discountId }) else {
                    throw notFound()
                }
                guard discount.isSelectable() else { throw discountInvalid() }
                let gross = input.unitPriceMinor * quantity
                discountMinor = switch discount.kind {
                case .percent: MoneyMath.percentOf(gross, basisPoints: discount.value)
                case .amount: min(discount.value, gross)
                }
                kind = discount.kind
                value = discount.value
            }

            let rate = input.vatRateBasisPoints ?? 2000
            let total = max(0, input.unitPriceMinor * quantity - discountMinor)
            let vat = MoneyMath.vatIncluded(total: total, rateBasisPoints: rate)
            let created = Charge(
                id: MockIDs.uuid(),
                branchId: MockIDs.branchNisantasi,
                customerId: input.customerId,
                source: source,
                appointmentServiceId: nil,
                customerPackageId: nil,
                description: input.description,
                quantity: quantity,
                unitListPriceMinor: listPrice,
                unitPriceMinor: input.unitPriceMinor,
                discountId: input.discountId,
                discountKind: kind,
                discountValue: value,
                discountMinor: discountMinor,
                vatRateBasisPoints: rate,
                totalMinor: total,
                netMinor: total - vat,
                vatMinor: vat,
                currency: "TRY",
                status: .open,
                priceOverrideReason: input.priceOverrideReason,
                voidedAt: nil,
                voidedReason: nil,
                version: 1,
                createdAt: Date()
            )
            chargeRecords.append(created)
            if let key = idempotencyKey { idempotency[key] = created.id }
            return created
        }
    }

    func charges(
        cursor: String?,
        limit: Int?,
        customerId: String?,
        branchId: String?,
        source: ChargeSource?,
        status: ChargeStatus?,
        from: Date?,
        to: Date?
    ) async throws -> Page<Charge> {
        await latency(0.3)
        return withLock {
            let filtered = chargeRecords
                .filter { customerId == nil || $0.customerId == customerId }
                .filter { branchId == nil || $0.branchId == branchId }
                .filter { source == nil || $0.source == source }
                .filter { status == nil || $0.status == status }
                .filter { from == nil || $0.createdAt >= from! }
                .filter { to == nil || $0.createdAt < to! }
                .sorted { $0.createdAt > $1.createdAt }
            return Page(data: filtered, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func charge(id: String) async throws -> Charge {
        await latency(0.2)
        return try withLock {
            guard let found = chargeRecords.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func updateCharge(id: String, version: Int, _ input: UpdateChargeInput) async throws -> Charge {
        await latency()
        return try withLock {
            guard let index = chargeRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = chargeRecords[index]
            guard old.version == version else { throw versionConflict() }
            guard old.status == .open else { throw validation("İptal edilmiş kalem düzenlenemez") }

            let quantity = input.quantity ?? old.quantity
            let unitPrice = input.unitPriceMinor ?? old.unitPriceMinor
            let reason = input.priceOverrideReason ?? old.priceOverrideReason
            if unitPrice != old.unitListPriceMinor, reason == nil {
                throw validation("Liste fiyatının dışına çıkılıyorsa gerekçe zorunlu")
            }

            var discountId = old.discountId
            var discountKind = old.discountKind
            var discountValue = old.discountValue
            switch input.discountId {
            case .unchanged: break
            case .clear:
                discountId = nil
                discountKind = nil
                discountValue = nil
            case .set(let newId):
                guard let discount = discountRecords.first(where: { $0.id == newId }) else {
                    throw notFound()
                }
                guard discount.isSelectable() else { throw discountInvalid() }
                discountId = newId
                discountKind = discount.kind
                discountValue = discount.value
            }

            let gross = unitPrice * quantity
            let discountMinor: Int = switch (discountKind, discountValue) {
            case (.percent, let value?): MoneyMath.percentOf(gross, basisPoints: value)
            case (.amount, let value?): min(value, gross)
            default: 0
            }
            let total = max(0, gross - discountMinor)
            let vat = MoneyMath.vatIncluded(total: total, rateBasisPoints: old.vatRateBasisPoints)

            // Düzeltme kalemi, üzerine yapılmış tahsisin altına DÜŞEMEZ:
            // sunucudaki `K0013` bunu aynı gerekçeyle reddediyor.
            if total < allocated(to: id) {
                throw exceedsBalance("Kalem tutarı, tahsis edilmiş tutarın altına indirilemez")
            }

            let updated = Charge(
                id: old.id,
                branchId: old.branchId,
                customerId: old.customerId,
                source: old.source,
                appointmentServiceId: old.appointmentServiceId,
                customerPackageId: old.customerPackageId,
                description: input.description ?? old.description,
                quantity: quantity,
                unitListPriceMinor: old.unitListPriceMinor,
                unitPriceMinor: unitPrice,
                discountId: discountId,
                discountKind: discountKind,
                discountValue: discountValue,
                discountMinor: discountMinor,
                vatRateBasisPoints: old.vatRateBasisPoints,
                totalMinor: total,
                netMinor: total - vat,
                vatMinor: vat,
                currency: old.currency,
                status: old.status,
                priceOverrideReason: reason,
                voidedAt: nil,
                voidedReason: nil,
                version: old.version + 1,
                createdAt: old.createdAt
            )
            chargeRecords[index] = updated
            return updated
        }
    }

    func voidCharge(id: String, version: Int, reason: String) async throws -> Charge {
        await latency()
        return try withLock {
            guard let index = chargeRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = chargeRecords[index]
            guard old.version == version else { throw versionConflict() }
            guard allocated(to: id) == 0 else {
                throw validation("Tahsilat yapılmış kalem iptal edilemez; önce tahsilatı iptal edin")
            }
            let updated = Self.copy(old, status: .void, reason: reason, version: old.version + 1)
            chargeRecords[index] = updated
            return updated
        }
    }

    func account(customerId: String, cursor: String?, limit: Int?) async throws -> CustomerAccount {
        await latency(0.3)
        return withLock {
            let charges = chargeRecords.filter { $0.customerId == customerId && $0.status == .open }
            let payments = paymentRecords.filter { $0.customerId == customerId && $0.status == .posted }
            let charged = charges.reduce(0) { $0 + $1.totalMinor }
            let paid = payments.reduce(0) { $0 + $1.amountMinor }

            let chargeEntries = charges.map {
                AccountEntry(
                    entryId: $0.id,
                    entryKind: .charge,
                    entrySource: $0.source.rawValue,
                    description: $0.description,
                    amountMinor: $0.totalMinor,
                    currency: $0.currency,
                    occurredAt: $0.createdAt
                )
            }
            let paymentEntries = payments.map {
                AccountEntry(
                    entryId: $0.id,
                    entryKind: .payment,
                    entrySource: $0.method.rawValue,
                    description: "Tahsilat #\($0.receiptNo)",
                    // Alacak NEGATİF — sunucudaki view de böyle döndürüyor.
                    amountMinor: -$0.amountMinor,
                    currency: $0.currency,
                    occurredAt: $0.paidAt
                )
            }
            return CustomerAccount(
                customerId: customerId,
                chargedMinor: charged,
                paidMinor: paid,
                balanceMinor: charged - paid,
                currency: "TRY",
                entries: (chargeEntries + paymentEntries).sorted { $0.occurredAt > $1.occurredAt },
                pageInfo: PageInfo(nextCursor: nil, hasMore: false)
            )
        }
    }

    // MARK: Tahsilat

    func createPayment(_ input: CreatePaymentInput, idempotencyKey: String?) async throws -> Payment {
        await latency()
        return try withLock {
            if let key = idempotencyKey, let existing = idempotency[key],
               let found = paymentRecords.first(where: { $0.id == existing }) {
                return found
            }

            // Nakit, açık bir kasa oturumuna bağlanmadan yazılamaz. Oturum
            // verilmediyse sunucu şubenin açık oturumunu KENDİSİ buluyor
            // (`PaymentsService.resolveCashSession`); mock'un bunu yapmaması,
            // canlıda çalışan bir isteği burada reddetmek olurdu.
            let sessionId = input.method.requiresCashSession
                ? try resolveCashSession(input.cashSessionId)
                : nil

            let resolved = try resolveAllocations(input)
            let allocatedTotal = resolved.reduce(0) { $0 + $1.amountMinor }
            guard allocatedTotal <= input.amountMinor else {
                throw exceedsBalance("Dağıtım toplamı tahsilat tutarını aşıyor")
            }

            receiptCounter += 1
            let now = Date()
            let paidAt = input.paidAt.flatMap(KlinaraCoding.parseTimestamp) ?? now
            let created = Payment(
                id: MockIDs.uuid(),
                branchId: MockIDs.branchNisantasi,
                customerId: input.customerId,
                method: input.method,
                amountMinor: input.amountMinor,
                allocatedMinor: allocatedTotal,
                unallocatedMinor: input.amountMinor - allocatedTotal,
                currency: "TRY",
                receiptNo: receiptCounter,
                paidAt: paidAt,
                cashSessionId: sessionId,
                note: input.note,
                status: .posted,
                voidedAt: nil,
                voidedReason: nil,
                allocations: resolved,
                version: 1,
                createdAt: now
            )
            paymentRecords.append(created)
            if let key = idempotencyKey { idempotency[key] = created.id }
            if let sessionId {
                appendMovement(
                    sessionId: sessionId,
                    kind: .payment,
                    amountMinor: created.amountMinor,
                    paymentId: created.id,
                    refundId: nil,
                    note: "Tahsilat #\(created.receiptNo)",
                    at: now
                )
            }
            commissions?.accrueForPayment(created)
            return created
        }
    }

    /// Tahsis çözümü — verilmemişse **eskiden yeniye** otomatik dağıtım.
    ///
    /// Elle verilen dağıtımda her kalem ayrı ayrı kontrol edilir: bir kaleme
    /// tahsis edilen toplam, kalemin açık bakiyesini aşamaz (`K0013`).
    private func resolveAllocations(_ input: CreatePaymentInput) throws -> [PaymentAllocation] {
        if let requested = input.allocations {
            return try requested.map { line in
                guard let charge = chargeRecords.first(where: { $0.id == line.chargeId }) else {
                    throw notFound()
                }
                guard charge.customerId == input.customerId else {
                    throw validation("Kalem bu müşteriye ait değil")
                }
                guard charge.status == .open else {
                    throw validation("İptal edilmiş kaleme tahsilat yapılamaz")
                }
                guard line.amountMinor <= openBalance(of: charge) else {
                    throw exceedsBalance("\(charge.description) kaleminin açık bakiyesi yetersiz")
                }
                return PaymentAllocation(
                    id: MockIDs.uuid(),
                    chargeId: charge.id,
                    amountMinor: line.amountMinor,
                    chargeDescription: charge.description
                )
            }
        }

        var remaining = input.amountMinor
        var lines: [PaymentAllocation] = []
        for charge in openCharges(for: input.customerId) where remaining > 0 {
            let take = min(remaining, openBalance(of: charge))
            guard take > 0 else { continue }
            lines.append(PaymentAllocation(
                id: MockIDs.uuid(),
                chargeId: charge.id,
                amountMinor: take,
                chargeDescription: charge.description
            ))
            remaining -= take
        }
        // Artan tutar avans olarak kalır — hata değil.
        return lines
    }

    func payments(
        cursor: String?,
        limit: Int?,
        customerId: String?,
        branchId: String?,
        method: PaymentMethod?,
        status: PaymentStatus?,
        from: Date?,
        to: Date?
    ) async throws -> Page<Payment> {
        await latency(0.3)
        return withLock {
            let filtered = paymentRecords
                .filter { customerId == nil || $0.customerId == customerId }
                .filter { branchId == nil || $0.branchId == branchId }
                .filter { method == nil || $0.method == method }
                .filter { status == nil || $0.status == status }
                .filter { from == nil || $0.paidAt >= from! }
                .filter { to == nil || $0.paidAt < to! }
                .sorted { $0.paidAt > $1.paidAt }
            return Page(data: filtered, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func payment(id: String) async throws -> Payment {
        await latency(0.2)
        return try withLock {
            guard let found = paymentRecords.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func voidPayment(id: String, version: Int, reason: String) async throws -> Payment {
        await latency()
        return try withLock {
            guard let index = paymentRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = paymentRecords[index]
            guard old.version == version else { throw versionConflict() }
            guard old.status == .posted else { throw validation("Tahsilat zaten iptal edilmiş") }

            let now = Date()
            // Tahsis satırları SİLİNMEZ; durum `void` olunca bakiye hesabına
            // girmiyorlar. Silmek makbuzun neyi kapattığını kaybettirirdi.
            let updated = Payment(
                id: old.id,
                branchId: old.branchId,
                customerId: old.customerId,
                method: old.method,
                amountMinor: old.amountMinor,
                allocatedMinor: old.allocatedMinor,
                unallocatedMinor: old.unallocatedMinor,
                currency: old.currency,
                receiptNo: old.receiptNo,
                paidAt: old.paidAt,
                cashSessionId: old.cashSessionId,
                note: old.note,
                status: .void,
                voidedAt: now,
                voidedReason: reason,
                allocations: old.allocations,
                version: old.version + 1,
                createdAt: old.createdAt
            )
            paymentRecords[index] = updated
            if let sessionId = old.cashSessionId {
                appendMovement(
                    sessionId: sessionId,
                    kind: .refund,
                    amountMinor: -old.amountMinor,
                    paymentId: old.id,
                    refundId: nil,
                    note: "Tahsilat iptali",
                    at: now
                )
            }
            commissions?.reverseForPayment(updated)
            return updated
        }
    }

    // MARK: Kasa

    func openCashSession(_ input: OpenCashSessionInput) async throws -> CashSession {
        await latency()
        return try withLock {
            let branchId = MockIDs.branchNisantasi
            guard !cashSessionRecords.contains(where: { $0.branchId == branchId && $0.isOpen }) else {
                throw cashAlreadyOpen()
            }
            let now = Date()
            let opening = input.openingBalanceMinor ?? 0
            let created = CashSession(
                id: MockIDs.uuid(),
                branchId: branchId,
                status: .open,
                openingBalanceMinor: opening,
                openedAt: now,
                closedAt: nil,
                expectedMinor: nil,
                countedMinor: nil,
                differenceMinor: nil,
                differenceReason: nil,
                currency: "TRY",
                version: 1
            )
            cashSessionRecords.append(created)
            appendMovement(
                sessionId: created.id,
                kind: .opening,
                amountMinor: opening,
                paymentId: nil,
                refundId: nil,
                note: "Açılış bakiyesi",
                at: now
            )
            return created
        }
    }

    func closeCashSession(
        id: String,
        version: Int,
        _ input: CloseCashSessionInput
    ) async throws -> CashSession {
        await latency()
        return try withLock {
            guard let index = cashSessionRecords.firstIndex(where: { $0.id == id }) else {
                throw notFound()
            }
            let old = cashSessionRecords[index]
            guard old.version == version else { throw versionConflict() }
            guard old.isOpen else { throw validation("Kasa zaten kapalı") }

            let expected = expectedCash(sessionId: id)
            let difference = input.countedMinor - expected
            // Fark varsa gerekçe ZORUNLU — sunucu da reddediyor, ama kullanıcıya
            // 422 yerine alan hatası göstermek için istemcide de duruyor.
            if difference != 0, (input.differenceReason ?? "").isEmpty {
                throw validation("Sayım farkı için gerekçe zorunlu")
            }

            let updated = CashSession(
                id: old.id,
                branchId: old.branchId,
                status: .closed,
                openingBalanceMinor: old.openingBalanceMinor,
                openedAt: old.openedAt,
                closedAt: Date(),
                expectedMinor: expected,
                countedMinor: input.countedMinor,
                differenceMinor: difference,
                differenceReason: input.differenceReason,
                currency: old.currency,
                version: old.version + 1
            )
            cashSessionRecords[index] = updated
            return updated
        }
    }

    func cashSessions(
        cursor: String?,
        limit: Int?,
        branchId: String?,
        status: CashSessionStatus?
    ) async throws -> Page<CashSession> {
        await latency(0.3)
        return withLock {
            let filtered = cashSessionRecords
                .filter { branchId == nil || $0.branchId == branchId }
                .filter { status == nil || $0.status == status }
                .sorted { $0.openedAt > $1.openedAt }
            return Page(data: filtered, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func cashSessionSummary(id: String) async throws -> CashSessionSummary {
        await latency(0.3)
        return try withLock {
            guard let session = cashSessionRecords.first(where: { $0.id == id }) else {
                throw notFound()
            }
            // Kırılım oturuma DEĞİL, şube + zaman penceresine göre: sunucudaki
            // `paymentsByMethod` de öyle yapıyor. Kart tahsilatı hiçbir kasa
            // oturumuna bağlanmaz ama o vardiyada alındıysa kırılımda görünmeli
            // — `cashSessionId`e göre süzmek onu tamamen kaybettirirdi.
            let sessionPayments = paymentRecords.filter { payment in
                payment.status == .posted
                    && payment.branchId == session.branchId
                    && payment.paidAt >= session.openedAt
                    && (session.closedAt.map { payment.paidAt <= $0 } ?? true)
            }
            let grouped = Dictionary(grouping: sessionPayments, by: \.method)
            let byMethod = PaymentMethod.allCases.compactMap { method -> CashMethodTotal? in
                guard let rows = grouped[method], !rows.isEmpty else { return nil }
                return CashMethodTotal(
                    method: method,
                    amountMinor: rows.reduce(0) { $0 + $1.amountMinor },
                    count: rows.count
                )
            }
            return CashSessionSummary(
                session: session,
                expectedMinor: expectedCash(sessionId: id),
                byMethod: byMethod,
                movements: movementRecords[id] ?? []
            )
        }
    }

    /// Beklenen nakit = açılış + nakit hareketler. Kart ve havale çekmeceye
    /// girmez; yöntem kırılımı onları ayrıca gösterir.
    private func expectedCash(sessionId: String) -> Int {
        (movementRecords[sessionId] ?? []).reduce(0) { $0 + $1.amountMinor }
    }

    /// Nakit işlemin bağlanacağı açık oturum. İstemci verdiyse doğrulanır,
    /// vermediyse şubenin açık oturumu bulunur; ikisi de yoksa istek reddedilir
    /// — sunucudaki `resolveCashSession` ile birebir aynı sıra.
    private func resolveCashSession(_ requested: String?) throws -> String {
        if let requested {
            guard let session = cashSessionRecords.first(where: { $0.id == requested }),
                  session.isOpen
            else { throw cashRequired() }
            return session.id
        }
        guard let open = cashSessionRecords.first(where: {
            $0.branchId == MockIDs.branchNisantasi && $0.isOpen
        }) else { throw cashRequired() }
        return open.id
    }

    private func appendMovement(
        sessionId: String,
        kind: CashMovementKind,
        amountMinor: Int,
        paymentId: String?,
        refundId: String?,
        note: String?,
        at date: Date
    ) {
        let movement = CashMovement(
            id: MockIDs.uuid(),
            kind: kind,
            amountMinor: amountMinor,
            paymentId: paymentId,
            refundId: refundId,
            note: note,
            createdAt: date
        )
        movementRecords[sessionId, default: []].append(movement)
    }

    func createRefund(_ input: CreateRefundInput, idempotencyKey: String?) async throws -> Refund {
        await latency()
        return try withLock {
            if let key = idempotencyKey, let existing = idempotency[key],
               let found = refundRecords.first(where: { $0.id == existing }) {
                return found
            }
            let refundSessionId = input.method.requiresCashSession
                ? try resolveCashSession(input.cashSessionId)
                : nil
            if input.kind == .package, input.customerPackageId == nil {
                throw validation("Paket iadesinde paket kimliği zorunlu")
            }

            let now = Date()
            let created = Refund(
                id: MockIDs.uuid(),
                customerId: input.customerId,
                kind: input.kind,
                amountMinor: input.amountMinor,
                method: input.method,
                chargeId: input.chargeId,
                customerPackageId: input.customerPackageId,
                cashSessionId: refundSessionId,
                reason: input.reason,
                refundedAt: now,
                packageSettlementStatus: input.kind == .package ? "settled" : nil
            )
            refundRecords.append(created)
            if let key = idempotencyKey { idempotency[key] = created.id }
            if let sessionId = created.cashSessionId {
                appendMovement(
                    sessionId: sessionId,
                    kind: .refund,
                    // İade çekmeceden ÇIKAR: negatif hareket.
                    amountMinor: -created.amountMinor,
                    paymentId: nil,
                    refundId: created.id,
                    note: created.reason,
                    at: now
                )
            }
            return created
        }
    }

    // MARK: İndirimler

    func discounts(cursor: String?, limit: Int?, activeOnly: Bool?) async throws -> Page<Discount> {
        await latency(0.3)
        return withLock {
            let filtered = discountRecords
                .filter { activeOnly != true || $0.isSelectable() }
                .sorted { $0.createdAt > $1.createdAt }
            return Page(data: filtered, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func discount(id: String) async throws -> Discount {
        await latency(0.2)
        return try withLock {
            guard let found = discountRecords.first(where: { $0.id == id }) else { throw notFound() }
            return found
        }
    }

    func createDiscount(_ input: CreateDiscountInput) async throws -> Discount {
        await latency()
        return try withLock {
            if let code = input.code,
               discountRecords.contains(where: { $0.code?.caseInsensitiveCompare(code) == .orderedSame }) {
                throw .problem(ProblemDetails(
                    code: .conflict,
                    title: "Çakışma",
                    detail: "Bu kampanya kodu zaten kullanılıyor",
                    status: 409
                )) as APIError
            }
            let now = Date()
            let created = Discount(
                id: MockIDs.uuid(),
                code: input.code,
                name: input.name,
                kind: input.kind,
                value: input.value,
                scope: input.scope ?? .all,
                scopeRefId: input.scopeRefId,
                startsAt: input.startsAt.flatMap(KlinaraCoding.parseTimestamp),
                endsAt: input.endsAt.flatMap(KlinaraCoding.parseTimestamp),
                maxRedemptions: input.maxRedemptions,
                redeemedCount: 0,
                isActive: true,
                version: 1,
                createdAt: now
            )
            discountRecords.append(created)
            return created
        }
    }

    func updateDiscount(
        id: String,
        version: Int,
        _ input: UpdateDiscountInput
    ) async throws -> Discount {
        await latency()
        return try withLock {
            guard let index = discountRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = discountRecords[index]
            guard old.version == version else { throw versionConflict() }
            let updated = Discount(
                id: old.id,
                code: old.code,
                name: input.name ?? old.name,
                kind: old.kind,
                value: old.value,
                scope: old.scope,
                scopeRefId: old.scopeRefId,
                startsAt: old.startsAt,
                endsAt: input.endsAt.flatMap(KlinaraCoding.parseTimestamp) ?? old.endsAt,
                maxRedemptions: input.maxRedemptions ?? old.maxRedemptions,
                redeemedCount: old.redeemedCount,
                isActive: input.isActive ?? old.isActive,
                version: old.version + 1,
                createdAt: old.createdAt
            )
            discountRecords[index] = updated
            return updated
        }
    }

    func deleteDiscount(id: String, version: Int) async throws {
        await latency()
        try withLock {
            guard let index = discountRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            guard discountRecords[index].version == version else { throw versionConflict() }
            discountRecords.remove(at: index)
        }
    }

    // MARK: Yardımcı

    private static func copy(
        _ charge: Charge,
        status: ChargeStatus,
        reason: String,
        version: Int
    ) -> Charge {
        Charge(
            id: charge.id,
            branchId: charge.branchId,
            customerId: charge.customerId,
            source: charge.source,
            appointmentServiceId: charge.appointmentServiceId,
            customerPackageId: charge.customerPackageId,
            description: charge.description,
            quantity: charge.quantity,
            unitListPriceMinor: charge.unitListPriceMinor,
            unitPriceMinor: charge.unitPriceMinor,
            discountId: charge.discountId,
            discountKind: charge.discountKind,
            discountValue: charge.discountValue,
            discountMinor: charge.discountMinor,
            vatRateBasisPoints: charge.vatRateBasisPoints,
            totalMinor: charge.totalMinor,
            netMinor: charge.netMinor,
            vatMinor: charge.vatMinor,
            currency: charge.currency,
            status: status,
            priceOverrideReason: charge.priceOverrideReason,
            voidedAt: status == .void ? Date() : charge.voidedAt,
            voidedReason: status == .void ? reason : charge.voidedReason,
            version: version,
            createdAt: charge.createdAt
        )
    }
}
