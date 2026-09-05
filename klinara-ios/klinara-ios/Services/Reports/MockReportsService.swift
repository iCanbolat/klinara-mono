import Foundation

/// Sunucu olmadan rapor ekranlarını sürmek için sabit rapor kümesi.
///
/// Paket ve finans mock'larından farklı olarak burada bir DEFTER YOK ve
/// olmamalı: raporlar türetilmiş veridir ve mock'un onları gerçekten
/// hesaplaması, sunucudaki SQL'in ikinci bir uygulamasını yazmak olurdu — iki
/// hesabın bir gün ayrışması kesin, ve ayrışan taraf hangisi olursa olsun
/// yanıltıcı. Mock burada yalnız **şekli** doğru bir yanıt döndürüyor.
///
/// Kapsam davranışı taklit ediliyor: `scopeIsOwn` açıkken yanıt tek satıra
/// iniyor ve `scope: .own` dönüyor. Ekrandaki rozet buna bağlı ve rozetin
/// mock'ta hiç çıkmaması, onu ancak canlıda sınamak demekti.
final class MockReportsService: ReportsService, @unchecked Sendable {

    private let lock = NSLock()
    private var scopeIsOwn: Bool

    init(scopeIsOwn: Bool = false) {
        self.scopeIsOwn = scopeIsOwn
    }

    func setScopeIsOwn(_ value: Bool) {
        lock.lock()
        defer { lock.unlock() }
        scopeIsOwn = value
    }

    private var scope: ReportScopeKind {
        lock.lock()
        defer { lock.unlock() }
        return scopeIsOwn ? .own : .all
    }

    private func period(from: Date, to: Date) -> ReportPeriod {
        ReportPeriod(from: KlinaraCoding.timestamp(from), to: KlinaraCoding.timestamp(to))
    }

    func occupancy(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: OccupancyGrouping?,
        compareToPrevious: Bool
    ) async throws -> OccupancyReport {
        let rows = MockReportsSeed.occupancyRows(groupBy: groupBy ?? .staff, ownOnly: scope == .own)
        let totals = MockReportsSeed.occupancyTotals(for: rows)
        return OccupancyReport(
            scope: scope,
            period: period(from: from, to: to),
            totals: totals,
            data: rows,
            previous: compareToPrevious ? MockReportsSeed.occupancyPrevious : nil,
            delta: compareToPrevious ? ["occupancyRate": 12.5, "bookedMinutes": nil] : nil
        )
    }

    func revenue(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: RevenueGrouping?,
        compareToPrevious: Bool
    ) async throws -> RevenueReport {
        let rows = MockReportsSeed.revenueRows(groupBy: groupBy ?? .service)
        return RevenueReport(
            scope: scope,
            period: period(from: from, to: to),
            totals: MockReportsSeed.revenueTotals,
            data: rows,
            previous: compareToPrevious ? MockReportsSeed.revenuePrevious : nil,
            delta: compareToPrevious ? ["collectedMinor": -8.4] : nil
        )
    }

    func staffPerformance(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) async throws -> StaffPerformanceReport {
        StaffPerformanceReport(
            scope: scope,
            period: period(from: from, to: to),
            data: MockReportsSeed.staffRows(ownOnly: scope == .own),
            currency: "TRY"
        )
    }

    func noShow(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: NoShowGrouping?,
        compareToPrevious: Bool
    ) async throws -> NoShowReport {
        NoShowReport(
            period: period(from: from, to: to),
            totals: MockReportsSeed.noShowTotals,
            data: MockReportsSeed.noShowRows,
            byOrigin: MockReportsSeed.noShowByOrigin,
            previous: compareToPrevious ? MockReportsSeed.noShowPrevious : nil,
            delta: compareToPrevious ? ["noShowRate": 3.2] : nil
        )
    }

    func retention(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool
    ) async throws -> RetentionReport {
        RetentionReport(
            period: period(from: from, to: to),
            totals: MockReportsSeed.retentionTotals,
            acquisition: MockReportsSeed.acquisition,
            cohorts: MockReportsSeed.cohorts,
            previous: compareToPrevious ? MockReportsSeed.retentionPrevious : nil,
            delta: compareToPrevious ? ["newCustomers": 25.0] : nil
        )
    }
}
