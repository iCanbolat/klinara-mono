import Foundation
import Testing
@testable import klinara_ios

/// Genel bakışın birleştirme kuralları ve izin kapıları — web
/// `dashboard-summary.test.ts` ve Android `DashboardTest` paritesi.
@MainActor
@Suite("Genel bakış")
struct DashboardTests {

    private let now = Date(timeIntervalSince1970: 1_789_376_400) // 2026-09-14T09:00:00Z
    private let kadikoy = BranchSummary(id: "b1", name: "Kadıköy", timezone: "Europe/Istanbul", address: nil, isActive: true)
    private let nisantasi = BranchSummary(id: "b2", name: "Nişantaşı", timezone: "Europe/Istanbul", address: nil, isActive: true)
    private let closed = BranchSummary(id: "b3", name: "Kapalı", timezone: "Europe/Istanbul", address: nil, isActive: false)

    private let period = ReportPeriod(from: "2026-09-01", to: "2026-10-01")

    private func entry(_ id: String, minutesFromNow: Double, _ status: AppointmentStatus) -> CalendarEntry {
        let start = now.addingTimeInterval(minutesFromNow * 60)
        return CalendarEntry(
            id: id, branchId: "b1", customerId: "c", customerName: id, customerPhone: nil,
            status: status, startsAt: start, endsAt: start.addingTimeInterval(1800),
            notes: nil, version: 1, totalMinor: 0, services: []
        )
    }

    private var occupancy: OccupancyReport {
        OccupancyReport(
            scope: .all, period: period,
            totals: OccupancyTotals(bookedMinutes: 0, availableMinutes: 0, occupancyRate: 61),
            data: [OccupancyRow(groupId: "b1", groupLabel: "Kadıköy", bookedMinutes: 0, availableMinutes: 0, occupancyRate: 72)],
            pageInfo: nil, previous: nil, delta: ["occupancyRate": 12]
        )
    }

    private var revenue: RevenueReport {
        RevenueReport(
            scope: .all, period: period,
            totals: RevenueTotals(accruedMinor: 150_000, collectedMinor: 0, refundedMinor: 0, currency: "TRY"),
            data: [RevenueRow(groupId: "b2", groupLabel: "Nişantaşı", accruedMinor: 150_000, collectedMinor: 0)],
            pageInfo: nil, previous: nil, delta: nil
        )
    }

    // MARK: Saf birleştirme

    @Test("Gün özeti: slot kaplayan, tamamlanan ve sıradakiler")
    func summarizesDay() {
        let day = DashboardSummaries.summarizeDay(
            [
                entry("done", minutesFromNow: -180, .completed),
                entry("later", minutesFromNow: 120, .scheduled),
                entry("soon", minutesFromNow: 60, .confirmed),
                entry("gone", minutesFromNow: 180, .cancelled),
                entry("past", minutesFromNow: -120, .scheduled),
            ],
            now: now
        )
        #expect(day.total == 5)
        #expect(day.active == 4)
        #expect(day.completed == 1)
        #expect(day.upcoming.map(\.id) == ["soon", "later"])
        #expect(day.pending == 2)
    }

    @Test("Önizleme sınırlı ama toplam korunuyor: 8 bekleyen → 5 satır, 'Tümünü gör' için 8")
    func previewIsBounded() {
        let entries = (1...8).map { entry("e\($0)", minutesFromNow: Double($0 * 30), .scheduled) }
        let day = DashboardSummaries.summarizeDay(entries, now: now)
        #expect(day.upcoming.count == DashboardSummaries.previewLimit)
        #expect(day.pending == 8)

        let summaries = DashboardSummaries.merge(
            branches: [kadikoy],
            days: ["b1": (entries: entries, timezone: "Europe/Istanbul")],
            occupancy: nil, revenue: nil, noShow: nil, now: now
        )
        #expect(DashboardSummaries.upcoming(summaries).count == DashboardSummaries.previewLimit)
        #expect(DashboardSummaries.pendingTotal(summaries) == 8)
    }

    @Test("Rapor geldiyse satırı olmayan şube SIFIR, rapor yoksa NIL; oran sunucu toplamından")
    func mergesAndTotals() {
        let summaries = DashboardSummaries.merge(
            branches: [kadikoy, nisantasi],
            days: ["b1": (entries: [entry("soon", minutesFromNow: 60, .scheduled)], timezone: "Europe/Istanbul")],
            occupancy: occupancy,
            revenue: revenue,
            noShow: nil,
            now: now
        )
        #expect(summaries[0].occupancyRate == 72)
        #expect(summaries[1].occupancyRate == 0)
        #expect(summaries[0].revenueMinor == 0)
        #expect(summaries[1].revenueMinor == 150_000)
        #expect(summaries[0].noShowRate == nil)
        // Takvimi alınamayan şube "0 randevu" değil, bilinmiyor.
        #expect(summaries[1].today == nil)

        let totals = DashboardSummaries.totals(summaries, occupancy: occupancy, revenue: revenue, noShow: nil)
        #expect(totals.todayTotal == 1)
        #expect(totals.occupancyRate == 61)
        #expect(totals.noShowRate == nil)

        #expect(DashboardSummaries.availableMetrics(summaries) == [.today, .occupancy, .revenue])
        #expect(DashboardSummaries.availableMetrics([]).isEmpty)
    }

    @Test("Personel cirosu: ciroya, eşitlikte işlem sayısına, o da eşitse ada göre")
    func sortsStaff() {
        func row(_ id: String, _ name: String, services: Int, revenue: Int) -> StaffPerformanceRow {
            StaffPerformanceRow(
                staffProfileId: id, staffName: name, completedServices: services, revenueMinor: revenue,
                commissionMinor: 0, bookedMinutes: 0, availableMinutes: 0, occupancyRate: 0
            )
        }
        let report = StaffPerformanceReport(
            scope: .all, period: period,
            data: [
                row("p1", "Elif", services: 4, revenue: 90_000),
                row("p2", "Zeynep", services: 7, revenue: 160_000),
                row("p3", "Can", services: 5, revenue: 90_000),
                // Planı var, bu ay hiçbir şey yapmamış: listeyi doldurmaz.
                row("p4", "Boş", services: 0, revenue: 0),
            ],
            pageInfo: nil, currency: "TRY"
        )
        #expect(DashboardSummaries.topStaffByRevenue(report).map(\.staffName) == ["Zeynep", "Can", "Elif"])
        #expect(DashboardSummaries.topStaffByRevenue(nil).isEmpty)
    }

    @Test("Erişim web ile aynı: uygulayıcının read.own'u şube karşılaştırması açmıyor")
    func accessMatchesWeb() {
        let practitioner: Set<String> = [Permissions.appointmentReadOwn, Permissions.reportPerformanceReadOwn]
        let access = DashboardAccess(can: practitioner.contains)
        #expect(access.calendar)
        #expect(!access.occupancy)
        #expect(!access.revenue)
        #expect(access.staff)
        #expect(DashboardAccess(can: { _ in false }).isEmpty)
    }

    @Test("Özet şeridi web KPI'larıyla aynı: izne göre kart, yüklenmeden önce değer yok")
    func statStrip() {
        let manager = DashboardAccess(calendar: true, occupancy: true, revenue: true, staff: true)
        let stats = DashboardView.stats(nil, access: manager)
        #expect(stats.map(\.label) == ["Bugünkü randevu", "Bu ay doluluk", "Bu ay ciro", "Bu ay gelmeme"])
        #expect(stats.allSatisfy { $0.value == nil })

        let accountant = DashboardAccess(calendar: false, occupancy: false, revenue: true, staff: true)
        #expect(DashboardView.stats(nil, access: accountant).map(\.label) == ["Bu ay ciro"])
    }

    // MARK: Store

    @Test("İzni olmayan kaynağa istek atılmıyor: muhasebe için takvim ve doluluk yok")
    func gatesRequests() async {
        let reports = RecordingReports()
        let store = DashboardStore(
            booking: MockGraph().booking,
            reports: reports,
            branches: [kadikoy, closed],
            access: DashboardAccess(can: [Permissions.reportRevenueRead].contains),
            now: { [now] in now }
        )
        await store.load()

        #expect(store.snapshot?.totals.todayTotal == nil)
        #expect(!reports.calls.contains { $0.hasPrefix("occupancy") })
        #expect(reports.calls.contains("revenue:branch"))
        // Pasif şube özete girmiyor.
        #expect(store.snapshot?.summaries.map(\.branch.id) == ["b1"])
    }

    @Test("Tek bir rapor düşerse yalnız rapor uyarısı; diğerleri dolu")
    func partialFailure() async {
        let reports = RecordingReports(failRevenue: true)
        let store = DashboardStore(
            booking: MockGraph().booking,
            reports: reports,
            branches: [kadikoy],
            access: DashboardAccess(can: [Permissions.appointmentReadAll, Permissions.reportRevenueRead].contains),
            now: { [now] in now }
        )
        await store.load()

        let snapshot = try? #require(store.snapshot)
        #expect(snapshot?.reportsError != nil)
        #expect(snapshot?.totals.revenueMinor == nil)
        #expect(snapshot?.totals.occupancyRate == 64)
        #expect(reports.calls.contains("occupancy:branch:true"))
    }
}

/// Raporları kaydeden sahte servis — doluluk ve ciro sabit gövde döndürür.
private final class RecordingReports: ReportsService, @unchecked Sendable {

    private let failRevenue: Bool
    private let lock = NSLock()
    private var recorded: [String] = []

    init(failRevenue: Bool = false) {
        self.failRevenue = failRevenue
    }

    var calls: [String] { lock.withLock { recorded } }

    private func record(_ call: String) { lock.withLock { recorded.append(call) } }

    private static let period = ReportPeriod(from: "", to: "")

    func occupancy(
        from: Date, to: Date, branchId: String?, groupBy: OccupancyGrouping?,
        compareToPrevious: Bool, page: ReportPageQuery
    ) async throws -> OccupancyReport {
        record("occupancy:\(groupBy?.rawValue ?? "-"):\(compareToPrevious)")
        return OccupancyReport(
            scope: .all, period: Self.period,
            totals: OccupancyTotals(bookedMinutes: 0, availableMinutes: 0, occupancyRate: 64),
            data: [], pageInfo: nil, previous: nil, delta: nil
        )
    }

    func revenue(
        from: Date, to: Date, branchId: String?, groupBy: RevenueGrouping?,
        compareToPrevious: Bool, page: ReportPageQuery
    ) async throws -> RevenueReport {
        record("revenue:\(groupBy?.rawValue ?? "-")")
        if failRevenue { throw APIError.network }
        return RevenueReport(
            scope: .all, period: Self.period,
            totals: RevenueTotals(accruedMinor: 1, collectedMinor: 0, refundedMinor: 0, currency: "TRY"),
            data: [], pageInfo: nil, previous: nil, delta: nil
        )
    }

    func staffPerformance(
        from: Date, to: Date, branchId: String?, compareToPrevious: Bool, page: ReportPageQuery
    ) async throws -> StaffPerformanceReport {
        record("staff")
        return StaffPerformanceReport(scope: .all, period: Self.period, data: [], pageInfo: nil, currency: "TRY")
    }

    func noShow(
        from: Date, to: Date, branchId: String?, groupBy: NoShowGrouping?,
        compareToPrevious: Bool, page: ReportPageQuery
    ) async throws -> NoShowReport {
        record("noShow:\(groupBy?.rawValue ?? "-")")
        return NoShowReport(
            period: Self.period,
            totals: NoShowTotals(total: 0, completed: 0, noShow: 0, cancelled: 0, noShowRate: 0, cancellationRate: 0),
            data: [], pageInfo: nil, byOrigin: [], previous: nil, delta: nil
        )
    }

    func retention(from: Date, to: Date, branchId: String?, compareToPrevious: Bool) async throws -> RetentionReport {
        record("retention")
        throw APIError.network
    }
}
