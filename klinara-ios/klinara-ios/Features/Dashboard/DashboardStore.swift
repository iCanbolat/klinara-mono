import SwiftUI

/// Genel bakışın verisi — web `use-dashboard.ts` ve Android
/// `DashboardViewModel` paritesi.
///
/// - İzni olmayan kaynağa istek HİÇ atılmıyor (``DashboardAccess``). 403'ü
///   yakalayıp bölümü gizlemek aynı ekranı çizerdi, ama her açılışta denetim
///   günlüğünü kırmızıya boyayarak.
/// - Kaynaklar AYRI düşebiliyor: tek bir şubenin günü ya da tek bir rapor
///   düşerse yalnız o bölüm uyarı gösteriyor.
/// - Yoklama YOK. Takvim canlı bir çalışma ekranı; burası bir bakış.
///
/// `calendar/day` şube başına, sorgudaki şubeyle atılıyor; `X-Branch-Id` seçili
/// şubeden gidiyor ve sunucu sorgudaki şubeye erişimi ayrıca doğruluyor. Gün
/// ŞUBENİN saat diliminde.
@MainActor
@Observable
final class DashboardStore {

    nonisolated struct Snapshot: Sendable {
        let summaries: [BranchDashboardSummary]
        let totals: DashboardTotals
        let occupancyDelta: Double?
        let revenueDelta: Double?
        let noShowDelta: Double?
        let staffPerformance: StaffPerformanceReport?
        let calendarError: APIError?
        let reportsError: APIError?
    }

    private let booking: any BookingService
    private let reports: any ReportsService
    private let branches: [BranchSummary]
    let access: DashboardAccess
    private let now: @Sendable () -> Date

    private(set) var snapshot: Snapshot?
    private(set) var isLoading = false

    init(
        booking: any BookingService,
        reports: any ReportsService,
        branches: [BranchSummary],
        access: DashboardAccess,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.booking = booking
        self.reports = reports
        self.branches = branches
        self.access = access
        self.now = now
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        let at = now()
        let active = DashboardSummaries.activeBranches(branches)
        let booking = self.booking
        let reports = self.reports
        // Alt görevler ana aktörde değil: izinler ve şube günleri önceden çıkarılıyor.
        let canOccupancy = access.occupancy
        let canRevenue = access.revenue
        let canStaff = access.staff
        let branchDays = active.map { (id: $0.id, date: BranchClock(branch: $0).localDateString(at)) }

        // Takvim: şube başına paralel. Hata şubeye özgü; ilk hata bölüm uyarısı olur.
        var days: [String: (entries: [CalendarEntry], timezone: String)] = [:]
        var calendarError: APIError?
        if access.calendar {
            await withTaskGroup(of: (String, Result<CalendarResponse, APIError>).self) { group in
                for day in branchDays {
                    group.addTask {
                        do {
                            let response = try await booking.calendarDay(
                                CalendarDayQuery(branchId: day.id, date: day.date)
                            )
                            return (day.id, .success(response))
                        } catch {
                            return (day.id, .failure(error as? APIError ?? .network))
                        }
                    }
                }
                for await (id, result) in group {
                    switch result {
                    case .success(let response):
                        days[id] = (response.appointments, response.timezone)
                    case .failure(let error):
                        calendarError = calendarError ?? error
                    }
                }
            }
        }

        // Ay sınırı ilk şubenin saatinde — web de tek bir "bu ay" aralığı gönderiyor.
        let clock = BranchClock(branch: active.first)
        let from = clock.startOfMonth(at)
        let to = clock.adding(months: 1, to: from)

        // Şube verilmiyor: sunucu "erişebildiğin tüm şubeler" için hesaplayıp
        // `groupBy=branch` ile satırlara bölüyor.
        async let occupancy = Self.attempt(canOccupancy) {
            try await reports.occupancy(
                from: from, to: to, branchId: nil, groupBy: .branch, compareToPrevious: true, page: .unpaged
            )
        }
        async let noShow = Self.attempt(canOccupancy) {
            try await reports.noShow(
                from: from, to: to, branchId: nil, groupBy: .branch, compareToPrevious: true, page: .unpaged
            )
        }
        async let revenue = Self.attempt(canRevenue) {
            try await reports.revenue(
                from: from, to: to, branchId: nil, groupBy: .branch, compareToPrevious: true, page: .unpaged
            )
        }
        // Personel kırılımı karşılaştırma almıyor; yalnız dönem.
        async let staff = Self.attempt(canStaff) {
            try await reports.staffPerformance(
                from: from, to: to, branchId: nil, compareToPrevious: false, page: .unpaged
            )
        }

        let (occupancyResult, noShowResult, revenueResult, staffResult) =
            await (occupancy, noShow, revenue, staff)
        let reportsError = occupancyResult.error ?? noShowResult.error ?? revenueResult.error ?? staffResult.error

        let summaries = DashboardSummaries.merge(
            branches: active,
            days: days,
            occupancy: occupancyResult.value,
            revenue: revenueResult.value,
            noShow: noShowResult.value,
            now: at
        )
        snapshot = Snapshot(
            summaries: summaries,
            totals: DashboardSummaries.totals(
                summaries,
                occupancy: occupancyResult.value,
                revenue: revenueResult.value,
                noShow: noShowResult.value
            ),
            occupancyDelta: occupancyResult.value?.delta?["occupancyRate"] ?? nil,
            revenueDelta: revenueResult.value?.delta?["accruedMinor"] ?? nil,
            noShowDelta: noShowResult.value?.delta?["noShowRate"] ?? nil,
            staffPerformance: staffResult.value,
            calendarError: calendarError,
            reportsError: reportsError
        )
    }

    /// İzin yoksa istek atılmaz ve sonuç boş; varsa hata bölüme düşer.
    private nonisolated static func attempt<Value: Sendable>(
        _ allowed: Bool,
        _ fetch: @Sendable () async throws -> Value
    ) async -> Outcome<Value> {
        guard allowed else { return Outcome(value: nil, error: nil) }
        do {
            return Outcome(value: try await fetch(), error: nil)
        } catch {
            return Outcome(value: nil, error: error as? APIError ?? .network)
        }
    }

    nonisolated struct Outcome<Value: Sendable>: Sendable {
        let value: Value?
        let error: APIError?
    }
}
