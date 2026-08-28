import Foundation

/// Sunucu olmadan prim ekranlarını sürmek için bellek-içi tahakkuk defteri.
///
/// Sunucunun iki kritik davranışını taklit eder:
///
/// - **Kural çözümünde belirsizlik yok**: personel bazlı override > kapsamlı
///   kural > genel, sonra öncelik. Mock'un rastgele bir kural seçmesi, ekranda
///   "hangi kural uygulandı" sorusunu cevaplanamaz kılardı.
/// - **Kapalı dönem donar**: kapalı döneme tahakkuk yazılamaz
///   (``APIErrorCode/periodClosed``); iptal ters kayıt olarak AÇIK döneme düşer.
final class MockCommissionsService: CommissionsService, @unchecked Sendable {

    private let lock = NSLock()

    private var ruleRecords: [CommissionRule] = []
    private var accrualRecords: [CommissionAccrual] = []
    private var periodRecords: [CommissionPeriod] = []

    init() {
        seed()
    }

    func reseed() {
        withLock { seed() }
    }

    private func seed() {
        let now = Date()
        ruleRecords = MockFinanceSeed.rules()
        periodRecords = MockFinanceSeed.periods(at: now)
        accrualRecords = MockFinanceSeed.accruals(at: now)
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func latency(_ seconds: Double = 0.4) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

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

    private func periodClosed() -> APIError {
        .problem(ProblemDetails(
            code: .periodClosed,
            title: "Dönem kapalı",
            detail: "Kapatılmış prim dönemi değiştirilemez",
            status: 409
        ))
    }

    private func conflict(_ detail: String) -> APIError {
        .problem(ProblemDetails(code: .conflict, title: "Çakışma", detail: detail, status: 409))
    }

    private func validation(_ detail: String) -> APIError {
        .problem(ProblemDetails(code: .validationFailed, title: "Geçersiz istek", detail: detail, status: 422))
    }

    // MARK: Kurallar

    func rules(cursor: String?, limit: Int?) async throws -> Page<CommissionRule> {
        await latency(0.3)
        return withLock {
            // Ekrandaki sıra çözüm sırasını YANSITIR: en spesifik kural üstte.
            // Alfabetik bir liste, kullanıcının "hangisi kazanır" sorusunu
            // cevaplamazdı.
            let sorted = ruleRecords.sorted { lhs, rhs in
                if Self.specificity(lhs) != Self.specificity(rhs) {
                    return Self.specificity(lhs) > Self.specificity(rhs)
                }
                if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
                return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
            }
            return Page(data: sorted, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func createRule(_ input: CreateCommissionRuleInput) async throws -> CommissionRule {
        await latency()
        return try withLock {
            let scope = input.scope ?? .global
            if scope.needsReference, input.scopeRefId == nil {
                throw validation("Bu kapsam için bir referans seçilmeli")
            }
            let priority = input.priority ?? 0
            // Sunucudaki `commission_rules_resolution_key` kısmi tekil indeksi:
            // aynı kapsam + personel + öncelik ile ikinci bir AKTİF kural olamaz.
            let clash = ruleRecords.contains {
                $0.isActive
                    && $0.scope == scope
                    && $0.scopeRefId == input.scopeRefId
                    && $0.staffProfileId == input.staffProfileId
                    && $0.priority == priority
            }
            guard !clash else {
                throw conflict("Aynı kapsam ve öncelikte aktif bir kural zaten var")
            }
            let created = CommissionRule(
                id: MockIDs.uuid(),
                name: input.name,
                scope: scope,
                scopeRefId: input.scopeRefId,
                staffProfileId: input.staffProfileId,
                calcKind: input.calcKind,
                value: input.value,
                basis: input.basis ?? .netAfterDiscount,
                triggerOn: input.triggerOn ?? .serviceCompleted,
                priority: priority,
                effectiveFrom: input.effectiveFrom,
                effectiveTo: input.effectiveTo,
                isActive: true,
                version: 1
            )
            ruleRecords.append(created)
            return created
        }
    }

    func updateRule(
        id: String,
        version: Int,
        _ input: UpdateCommissionRuleInput
    ) async throws -> CommissionRule {
        await latency()
        return try withLock {
            guard let index = ruleRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = ruleRecords[index]
            guard old.version == version else { throw versionConflict() }
            let priority = input.priority ?? old.priority
            let isActive = input.isActive ?? old.isActive
            if isActive {
                let clash = ruleRecords.contains {
                    $0.id != id
                        && $0.isActive
                        && $0.scope == old.scope
                        && $0.scopeRefId == old.scopeRefId
                        && $0.staffProfileId == old.staffProfileId
                        && $0.priority == priority
                }
                guard !clash else {
                    throw conflict("Aynı kapsam ve öncelikte aktif bir kural zaten var")
                }
            }
            let updated = CommissionRule(
                id: old.id,
                name: input.name ?? old.name,
                scope: old.scope,
                scopeRefId: old.scopeRefId,
                staffProfileId: old.staffProfileId,
                calcKind: old.calcKind,
                value: input.value ?? old.value,
                basis: old.basis,
                triggerOn: old.triggerOn,
                priority: priority,
                effectiveFrom: old.effectiveFrom,
                effectiveTo: input.effectiveTo ?? old.effectiveTo,
                isActive: isActive,
                version: old.version + 1
            )
            ruleRecords[index] = updated
            return updated
        }
    }

    func deleteRule(id: String, version: Int) async throws {
        await latency()
        try withLock {
            guard let index = ruleRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            guard ruleRecords[index].version == version else { throw versionConflict() }
            ruleRecords.remove(at: index)
        }
    }

    // MARK: Tahakkuk

    func accruals(
        cursor: String?,
        limit: Int?,
        staffProfileId: String?,
        periodId: String?
    ) async throws -> Page<CommissionAccrual> {
        await latency(0.3)
        return withLock {
            let filtered = accrualRecords
                .filter { staffProfileId == nil || $0.staffProfileId == staffProfileId }
                .filter { periodId == nil || $0.periodId == periodId }
                .sorted { $0.createdAt > $1.createdAt }
            return Page(data: filtered, pageInfo: PageInfo(nextCursor: nil, hasMore: false))
        }
    }

    func periods(
        branchId: String?,
        status: CommissionPeriodStatus?
    ) async throws -> [CommissionPeriod] {
        await latency(0.3)
        return withLock {
            periodRecords
                .filter { branchId == nil || $0.branchId == branchId }
                .filter { status == nil || $0.status == status }
                .sorted { $0.startsOn > $1.startsOn }
        }
    }

    func closePeriod(id: String, version: Int) async throws -> CommissionPeriod {
        await latency()
        return try withLock {
            guard let index = periodRecords.firstIndex(where: { $0.id == id }) else { throw notFound() }
            let old = periodRecords[index]
            guard old.version == version else { throw versionConflict() }
            guard !old.isClosed else { throw periodClosed() }
            let updated = CommissionPeriod(
                id: old.id,
                branchId: old.branchId,
                startsOn: old.startsOn,
                endsOn: old.endsOn,
                status: .closed,
                closedAt: Date(),
                version: old.version + 1
            )
            periodRecords[index] = updated
            return updated
        }
    }

    func report(
        periodId: String?,
        branchId: String?,
        from: String?,
        to: String?
    ) async throws -> CommissionReport {
        await latency(0.3)
        return withLock {
            let scoped = accrualRecords.filter { periodId == nil || $0.periodId == periodId }
            let grouped = Dictionary(grouping: scoped, by: \.staffProfileId)
            // Ters kayıtlar NEGATİF tutar taşıyor; toplamda kendiliğinden
            // düşüyorlar. Ayrıca filtrelemek onları iki kez saymak olurdu.
            let rows = grouped
                .map { staffId, entries in
                    CommissionReportRow(
                        staffProfileId: staffId,
                        staffName: MockFinanceSeed.staffName(for: staffId),
                        amountMinor: entries.reduce(0) { $0 + $1.amountMinor },
                        accrualCount: entries.count
                    )
                }
                .sorted { $0.amountMinor > $1.amountMinor }
            return CommissionReport(
                rows: rows,
                totalMinor: rows.reduce(0) { $0 + $1.amountMinor },
                currency: "TRY"
            )
        }
    }

    // MARK: Tahsilat kancaları
    //
    // ``MockFinanceService`` bunları tahsilat yazılınca ve iptal edilince
    // çağırır. Gerçek sunucuda aynı transaction'da olan şey burada iki mock
    // arasında bir çağrı; ayrışmaları ekranda "tahsilat oldu ama prim yok"
    // görüntüsü üretirdi.

    /// Tahsilat tetikleyicili kurallar için tahakkuk yazar.
    ///
    /// Kısmi tahsilat **kısmi prim** üretir: matrah tahsil edilen tutardır.
    func accrueForPayment(_ payment: Payment) {
        lock.lock()
        defer { lock.unlock() }
        guard let rule = resolveRule(triggerOn: .paymentReceived) else { return }
        guard let period = currentOpenPeriod() else { return }
        let staffId = rule.staffProfileId ?? MockStaffSeed.profileMehmet
        let amount = switch rule.calcKind {
        case .percent: MoneyMath.percentOf(payment.amountMinor, basisPoints: rule.value)
        case .fixed: rule.value
        }
        accrualRecords.append(CommissionAccrual(
            id: MockIDs.uuid(),
            staffProfileId: staffId,
            periodId: period.id,
            triggerOn: .paymentReceived,
            ruleBasis: rule.basis,
            basisMinor: payment.amountMinor,
            amountMinor: amount,
            chargeId: nil,
            paymentId: payment.id,
            reversesAccrualId: nil,
            reason: nil,
            createdAt: Date()
        ))
    }

    /// Tahsilat iptalinde ters kayıt. **Açık** döneme yazılır: geçmişi
    /// değiştirmek yerine düzeltmeyi bugüne taşımak muhasebe pratiğidir.
    func reverseForPayment(_ payment: Payment) {
        lock.lock()
        defer { lock.unlock() }
        guard let period = currentOpenPeriod() else { return }
        let originals = accrualRecords.filter { $0.paymentId == payment.id && !$0.isReversal }
        for original in originals {
            let alreadyReversed = accrualRecords.contains { $0.reversesAccrualId == original.id }
            guard !alreadyReversed else { continue }
            accrualRecords.append(CommissionAccrual(
                id: MockIDs.uuid(),
                staffProfileId: original.staffProfileId,
                periodId: period.id,
                triggerOn: original.triggerOn,
                ruleBasis: original.ruleBasis,
                basisMinor: -original.basisMinor,
                amountMinor: -original.amountMinor,
                chargeId: original.chargeId,
                paymentId: original.paymentId,
                reversesAccrualId: original.id,
                reason: "Tahsilat iptali",
                createdAt: Date()
            ))
        }
    }

    /// Çözüm sırası: personel bazlı override > kapsamlı kural > genel, sonra
    /// öncelik. **Tek** kural döner; belirsizlik yok.
    private func resolveRule(triggerOn: CommissionTrigger) -> CommissionRule? {
        ruleRecords
            .filter { $0.isActive && $0.triggerOn == triggerOn }
            .max { lhs, rhs in
                if Self.specificity(lhs) != Self.specificity(rhs) {
                    return Self.specificity(lhs) < Self.specificity(rhs)
                }
                return lhs.priority < rhs.priority
            }
    }

    /// 2 = personel bazlı override, 1 = kapsamlı, 0 = genel.
    private static func specificity(_ rule: CommissionRule) -> Int {
        if rule.staffProfileId != nil { return 2 }
        return rule.scope == .global ? 0 : 1
    }

    private func currentOpenPeriod() -> CommissionPeriod? {
        periodRecords.first { !$0.isClosed }
    }
}
