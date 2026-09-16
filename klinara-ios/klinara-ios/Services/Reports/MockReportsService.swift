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

    /// Sunucudaki ``pageRows`` davranışının aynısı.
    ///
    /// Mock'un sayfalamayı taklit etmemesi, sayfa sınırındaki hataların yalnız
    /// canlıda görünmesi demekti. Kural birebir aynı: `limit` yoksa tüm
    /// satırlar döner (sayfalama opt-in), cursor hem sıra numarası hem çıpa
    /// taşır ve toplamlar sayfadan ETKİLENMEZ.
    private func paginate<Row>(
        _ rows: [Row],
        _ page: ReportPageQuery,
        key: (Row) -> String
    ) throws -> (data: [Row], pageInfo: PageInfo) {
        guard page.limit != nil || page.cursor != nil else {
            return (rows, PageInfo(nextCursor: nil, hasMore: false))
        }
        let limit = min(page.limit ?? 50, 200)

        var start = 0
        if let cursor = page.cursor {
            guard let decoded = MockCursor.decodeKey(cursor) else {
                throw MockErrors.validation("Geçersiz cursor", path: "cursor")
            }
            // Çıpa hâlâ listedeyse ondan SONRA devam; kaybolmuşsa sıra
            // numarasına düşülür — sunucudaki kuralın aynısı.
            let ordinal = Int(decoded.sortKey.timeIntervalSince1970)
            start = rows.firstIndex { key($0) == decoded.id }.map { $0 + 1 } ?? max(ordinal, 0)
        }

        let data = Array(rows.dropFirst(start).prefix(limit))
        let hasMore = start + data.count < rows.count
        let next = hasMore && !data.isEmpty
            ? MockCursor.encode(
                sortKey: Date(timeIntervalSince1970: Double(start + data.count)),
                id: key(data[data.count - 1])
            )
            : nil
        return (data, PageInfo(nextCursor: next, hasMore: hasMore))
    }

    func occupancy(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: OccupancyGrouping?,
        compareToPrevious: Bool,
        page: ReportPageQuery
    ) async throws -> OccupancyReport {
        let rows = MockReportsSeed.occupancyRows(groupBy: groupBy ?? .staff, ownOnly: scope == .own)
        // Toplamlar SAYFADAN DEĞİL, satırların tamamından.
        let totals = MockReportsSeed.occupancyTotals(for: rows)
        let slice = try paginate(rows, page) { $0.groupId ?? $0.groupLabel }
        return OccupancyReport(
            scope: scope,
            period: period(from: from, to: to),
            totals: totals,
            data: slice.data,
            pageInfo: slice.pageInfo,
            previous: compareToPrevious ? MockReportsSeed.occupancyPrevious : nil,
            delta: compareToPrevious ? ["occupancyRate": 12.5, "bookedMinutes": nil] : nil
        )
    }

    func revenue(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: RevenueGrouping?,
        compareToPrevious: Bool,
        page: ReportPageQuery
    ) async throws -> RevenueReport {
        let rows = MockReportsSeed.revenueRows(groupBy: groupBy ?? .service)
        let slice = try paginate(rows, page) { $0.groupId ?? $0.groupLabel }
        return RevenueReport(
            scope: scope,
            period: period(from: from, to: to),
            totals: MockReportsSeed.revenueTotals,
            data: slice.data,
            pageInfo: slice.pageInfo,
            previous: compareToPrevious ? MockReportsSeed.revenuePrevious : nil,
            delta: compareToPrevious ? ["accruedMinor": 13.6] : nil
        )
    }

    func staffPerformance(
        from: Date,
        to: Date,
        branchId: String?,
        compareToPrevious: Bool,
        page: ReportPageQuery
    ) async throws -> StaffPerformanceReport {
        let rows = MockReportsSeed.staffRows(ownOnly: scope == .own)
        let slice = try paginate(rows, page) { $0.staffProfileId }
        return StaffPerformanceReport(
            scope: scope,
            period: period(from: from, to: to),
            data: slice.data,
            pageInfo: slice.pageInfo,
            currency: "TRY"
        )
    }

    func noShow(
        from: Date,
        to: Date,
        branchId: String?,
        groupBy: NoShowGrouping?,
        compareToPrevious: Bool,
        page: ReportPageQuery
    ) async throws -> NoShowReport {
        let slice = try paginate(MockReportsSeed.noShowRows, page) { $0.groupId ?? $0.groupLabel }
        return NoShowReport(
            period: period(from: from, to: to),
            totals: MockReportsSeed.noShowTotals,
            data: slice.data,
            pageInfo: slice.pageInfo,
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
