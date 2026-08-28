import SwiftUI

/// Prim kuralları, tahakkuklar, dönemler ve rapor.
///
/// **Ekran ömürlü**: prim ekranları uygulamanın günlük akışında değil, ayda bir
/// girilen bir köşesinde. Oturum boyunca bellekte tutmanın karşılığı yok —
/// ``PackageReportsStore`` ile aynı gerekçe.
@MainActor
@Observable
final class CommissionStore {

    private let service: any CommissionsService

    private(set) var rulesState: LoadState<[CommissionRule]> = .loading
    private(set) var accrualsState: LoadState<[CommissionAccrual]> = .loading
    private(set) var periodsState: LoadState<[CommissionPeriod]> = .loading
    private(set) var reportState: LoadState<CommissionReport> = .loading

    private(set) var ruleCursor: String?
    private(set) var accrualCursor: String?
    private(set) var isLoadingMore = false
    private(set) var isSaving = false

    /// Rapor ve tahakkuk listesinin ortak süzgeci. `nil` = tüm dönemler.
    var selectedPeriodId: String?
    var selectedStaffProfileId: String?

    init(service: any CommissionsService) {
        self.service = service
    }

    var rules: [CommissionRule] { rulesState.value ?? [] }
    var accruals: [CommissionAccrual] { accrualsState.value ?? [] }
    var periods: [CommissionPeriod] { periodsState.value ?? [] }
    var report: CommissionReport? { reportState.value }

    var openPeriods: [CommissionPeriod] { periods.filter { !$0.isClosed } }

    // MARK: Okuma

    func loadRules() async {
        rulesState = .loading
        ruleCursor = nil
        do {
            let page = try await service.rules(cursor: nil, limit: nil)
            rulesState = .loaded(page.data)
            ruleCursor = page.pageInfo.nextCursor
        } catch {
            rulesState = .failed(error as? APIError ?? .network)
        }
    }

    func loadMoreRules() async {
        guard let cursor = ruleCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.rules(cursor: cursor, limit: nil)
            rulesState = .loaded(rules + page.data)
            ruleCursor = page.pageInfo.nextCursor
        } catch {
            ruleCursor = cursor
        }
    }

    func loadAccruals() async {
        accrualsState = .loading
        accrualCursor = nil
        do {
            let page = try await service.accruals(
                cursor: nil,
                limit: nil,
                staffProfileId: selectedStaffProfileId,
                periodId: selectedPeriodId
            )
            accrualsState = .loaded(page.data)
            accrualCursor = page.pageInfo.nextCursor
        } catch {
            accrualsState = .failed(error as? APIError ?? .network)
        }
    }

    func loadMoreAccruals() async {
        guard let cursor = accrualCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.accruals(
                cursor: cursor,
                limit: nil,
                staffProfileId: selectedStaffProfileId,
                periodId: selectedPeriodId
            )
            accrualsState = .loaded(accruals + page.data)
            accrualCursor = page.pageInfo.nextCursor
        } catch {
            accrualCursor = cursor
        }
    }

    /// Dönemler **çıplak dizi** döner, sayfalanmıyor.
    func loadPeriods() async {
        periodsState = .loading
        do {
            periodsState = .loaded(try await service.periods(branchId: nil, status: nil))
        } catch {
            periodsState = .failed(error as? APIError ?? .network)
        }
    }

    func loadReport() async {
        reportState = .loading
        do {
            reportState = .loaded(try await service.report(
                periodId: selectedPeriodId,
                branchId: nil,
                from: nil,
                to: nil
            ))
        } catch {
            reportState = .failed(error as? APIError ?? .network)
        }
    }

    /// Süzgeç değiştiğinde rapor ve tahakkuklar birlikte tazelenir: ikisi aynı
    /// soruyu iki kırılımda cevaplıyor ve ayrı dönemleri göstermeleri okunmaz olurdu.
    func applyFilter(periodId: String?) async {
        selectedPeriodId = periodId
        async let report: Void = loadReport()
        async let accruals: Void = loadAccruals()
        _ = await (report, accruals)
    }

    func period(id: String) -> CommissionPeriod? {
        periods.first { $0.id == id }
    }

    // MARK: Yazma

    func createRule(_ input: CreateCommissionRuleInput) async throws -> CommissionRule {
        try await mutating {
            let created = try await service.createRule(input)
            await loadRules()
            return created
        }
    }

    func updateRule(
        id: String,
        version: Int,
        _ input: UpdateCommissionRuleInput
    ) async throws -> CommissionRule {
        try await mutating {
            let updated = try await service.updateRule(id: id, version: version, input)
            await loadRules()
            return updated
        }
    }

    func deleteRule(id: String, version: Int) async throws {
        _ = try await mutating {
            try await service.deleteRule(id: id, version: version)
            rulesState = .loaded(rules.filter { $0.id != id })
        }
    }

    func closePeriod(id: String, version: Int) async throws -> CommissionPeriod {
        try await mutating {
            let closed = try await service.closePeriod(id: id, version: version)
            var list = periods
            if let index = list.firstIndex(where: { $0.id == id }) {
                list[index] = closed
                periodsState = .loaded(list)
            }
            return closed
        }
    }

    private func mutating<T>(_ work: () async throws -> T) async throws -> T {
        isSaving = true
        defer { isSaving = false }
        return try await work()
    }
}
