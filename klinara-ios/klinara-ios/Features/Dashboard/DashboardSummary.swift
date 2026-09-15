import Foundation

/// Genel bakışın özeti — **saf**, SwiftUI'sız. Web `lib/dashboard/summary.ts`
/// ve Android `DashboardSummary.kt` paritesi.
///
/// Ayrı bir sunucu ucu yok: özet mevcut uçlardan İSTEMCİDE birleştiriliyor
/// (şube başına `calendar/day` + `groupBy=branch` ile üç rapor). Bir kliniğin
/// şube sayısı tek haneli; N+3 istek bir uç, DTO ve sözleşme testinden ucuz.
///
/// Her kaynak AYRI düşebiliyor; eksik veri `nil` — "sıfır" değil. Sıfır bir
/// ölçümdür, `nil` "bilinmiyor".

/// Hangi bölüm hangi izinle — web `use-dashboard.ts` kapılarının aynısı.
struct DashboardAccess: Equatable {
    let calendar: Bool
    /// Şube kırılımlı doluluk ve gelmeme OPERASYONEL; uygulayıcının `read.own`u
    /// şube karşılaştırması açmıyor.
    let occupancy: Bool
    let revenue: Bool
    let staff: Bool

    var isEmpty: Bool { !calendar && !occupancy && !revenue && !staff }

    init(calendar: Bool, occupancy: Bool, revenue: Bool, staff: Bool) {
        self.calendar = calendar
        self.occupancy = occupancy
        self.revenue = revenue
        self.staff = staff
    }

    init(can: (String) -> Bool) {
        self.init(
            calendar: can(Permissions.appointmentReadAll) || can(Permissions.appointmentReadOwn),
            occupancy: can(Permissions.appointmentReadAll),
            revenue: can(Permissions.reportRevenueRead),
            staff: can(Permissions.reportRevenueRead) || can(Permissions.reportPerformanceReadOwn)
        )
    }
}

nonisolated struct DaySummary: Sendable, Equatable {
    let total: Int
    /// Slot kaplayanlar — iptal ve gelmedi hariç.
    let active: Int
    let completed: Int
    /// Henüz başlamamış, slot kaplayan randevular; başlangıca göre sıralı,
    /// önizleme kadar kırpılmış.
    let upcoming: [CalendarEntry]
    /// Kırpılmadan önceki bekleyen randevu sayısı — "Tümünü gör" bu sayıdan.
    let pending: Int
}

nonisolated struct BranchDashboardSummary: Sendable, Equatable, Identifiable {
    let branch: BranchSummary
    /// `nil`: takvim izni yok ya da o şubenin günü alınamadı.
    let today: DaySummary?
    let timezone: String
    let occupancyRate: Double?
    let revenueMinor: Int?
    let noShowRate: Double?

    var id: String { branch.id }
}

nonisolated struct DashboardTotals: Sendable, Equatable {
    let todayTotal: Int?
    let todayActive: Int?
    let todayCompleted: Int?
    let occupancyRate: Double?
    let revenueMinor: Int?
    let currency: String
    let noShowRate: Double?
}

nonisolated enum BranchMetric: String, Sendable, CaseIterable, Identifiable, Hashable {
    case today, occupancy, revenue, noShow

    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Bugün"
        case .occupancy: return "Doluluk"
        case .revenue: return "Ciro"
        case .noShow: return "Gelmeme"
        }
    }
}

/// Tüm şubelerin sıradaki randevusu, tek listede.
nonisolated struct UpcomingItem: Sendable, Identifiable {
    let entry: CalendarEntry
    let branchName: String
    let timezone: String

    var id: String { entry.id }
}

nonisolated enum DashboardSummaries {

    /// Listelerin önizleme boyu. Kart ekranda SINIRLI yer kaplamalı: 30
    /// randevulu bir günde kart sayfayı ele geçirir ve altındaki grafik hiç
    /// görülmezdi. Fazlası "Tümünü gör" ile açılır.
    static let previewLimit = 5

    private static func occupiesSlot(_ status: AppointmentStatus) -> Bool {
        status != .cancelled && status != .noShow
    }

    /// Pasif şubeler dışarıda: kapanmış bir şubenin "bugün 0 randevu" satırı
    /// bilgi değil gürültü.
    static func activeBranches(_ branches: [BranchSummary]) -> [BranchSummary] {
        branches.filter(\.isActive)
    }

    static func summarizeDay(_ entries: [CalendarEntry], now: Date, upcomingLimit: Int = previewLimit) -> DaySummary {
        let active = entries.filter { occupiesSlot($0.status) }
        let pending = active
            .filter { $0.status != .completed && $0.startsAt >= now }
            .sorted { $0.startsAt < $1.startsAt }
        return DaySummary(
            total: entries.count,
            active: active.count,
            completed: entries.filter { $0.status == .completed }.count,
            // Şube başına önizleme kadarı yeter: birleşik listenin ilk N'i her
            // şubenin ilk N'inden gelir.
            upcoming: Array(pending.prefix(upcomingLimit)),
            pending: pending.count
        )
    }

    /// Tüm şubelerde bugün bekleyen randevu sayısı (önizlemeden bağımsız).
    static func pendingTotal(_ summaries: [BranchDashboardSummary]) -> Int {
        summaries.reduce(0) { $0 + ($1.today?.pending ?? 0) }
    }

    /// Rapor geldiyse ama şubenin satırı yoksa o dönemde veri YOK demektir —
    /// sıfır. Rapor hiç gelmediyse bilinmiyor — `nil`.
    static func merge(
        branches: [BranchSummary],
        days: [String: (entries: [CalendarEntry], timezone: String)],
        occupancy: OccupancyReport?,
        revenue: RevenueReport?,
        noShow: NoShowReport?,
        now: Date
    ) -> [BranchDashboardSummary] {
        let occupancyRows = rowsById(occupancy?.data ?? [], id: \.groupId)
        let revenueRows = rowsById(revenue?.data ?? [], id: \.groupId)
        let noShowRows = rowsById(noShow?.data ?? [], id: \.groupId)

        return branches.map { branch in
            let day = days[branch.id]
            return BranchDashboardSummary(
                branch: branch,
                today: day.map { summarizeDay($0.entries, now: now) },
                timezone: day?.timezone ?? branch.timezone,
                occupancyRate: occupancy.map { _ in occupancyRows[branch.id]?.occupancyRate ?? 0 },
                revenueMinor: revenue.map { _ in revenueRows[branch.id]?.accruedMinor ?? 0 },
                noShowRate: noShow.map { _ in noShowRows[branch.id]?.noShowRate ?? 0 }
            )
        }
    }

    /// Oranlar şube ortalaması DEĞİL, raporun kendi `totals`ından: 10 randevulu
    /// şubeyle 200 randevulu şubeyi eşit ağırlıkla ortalamak yanlış bir sayı
    /// üretir.
    static func totals(
        _ summaries: [BranchDashboardSummary],
        occupancy: OccupancyReport?,
        revenue: RevenueReport?,
        noShow: NoShowReport?
    ) -> DashboardTotals {
        let days = summaries.compactMap(\.today)
        func sum(_ pick: (DaySummary) -> Int) -> Int? {
            days.isEmpty ? nil : days.reduce(0) { $0 + pick($1) }
        }
        return DashboardTotals(
            todayTotal: sum(\.total),
            todayActive: sum(\.active),
            todayCompleted: sum(\.completed),
            occupancyRate: occupancy?.totals.occupancyRate,
            revenueMinor: revenue?.totals.accruedMinor,
            currency: revenue?.totals.currency ?? "TRY",
            noShowRate: noShow?.totals.noShowRate
        )
    }

    static func upcoming(_ summaries: [BranchDashboardSummary], limit: Int = previewLimit) -> [UpcomingItem] {
        Array(
            summaries
                .flatMap { summary in
                    (summary.today?.upcoming ?? []).map {
                        UpcomingItem(entry: $0, branchName: summary.branch.name, timezone: summary.timezone)
                    }
                }
                .sorted { $0.entry.startsAt < $1.entry.startsAt }
                .prefix(limit)
        )
    }

    /// Grafikte seçilebilir göstergeler, sabit sırayla. Rapor göstergesi ya tüm
    /// şubelerde bilinir ya hiçbirinde (aynı rapordan); bugün şube şube
    /// düşebildiği için "en az bir şubede" yeterli.
    static func availableMetrics(_ summaries: [BranchDashboardSummary]) -> [BranchMetric] {
        guard let first = summaries.first else { return [] }
        var metrics: [BranchMetric] = []
        if summaries.contains(where: { $0.today != nil }) { metrics.append(.today) }
        if first.occupancyRate != nil { metrics.append(.occupancy) }
        if first.revenueMinor != nil { metrics.append(.revenue) }
        if first.noShowRate != nil { metrics.append(.noShow) }
        return metrics
    }

    /// Çubuğun sayısal değeri; bilinmeyen 0 çizilir.
    static func value(_ summary: BranchDashboardSummary, _ metric: BranchMetric) -> Double {
        switch metric {
        case .today: return Double(summary.today?.total ?? 0)
        case .occupancy: return summary.occupancyRate ?? 0
        case .revenue: return Double(summary.revenueMinor ?? 0)
        case .noShow: return summary.noShowRate ?? 0
        }
    }

    /// Ciroya, eşitlikte işlem sayısına, o da eşitse ada göre — sıra her
    /// yenilemede aynı kalmalı.
    ///
    /// Bu ay ne işlemi ne cirosu olan personel DIŞARIDA: çalışma planı olduğu
    /// için raporda satırı var ama "₺0,00 · 0 işlem" satırları listeyi bilgi
    /// taşımayan kayıtlarla dolduruyor ve ayın başında boş durumu hiç
    /// göstermiyordu.
    static func topStaffByRevenue(_ report: StaffPerformanceReport?) -> [StaffPerformanceRow] {
        let locale = Locale(identifier: "tr_TR")
        return (report?.data ?? [])
                .filter { $0.revenueMinor != 0 || $0.completedServices != 0 }
                .sorted { lhs, rhs in
                    if lhs.revenueMinor != rhs.revenueMinor { return lhs.revenueMinor > rhs.revenueMinor }
                    if lhs.completedServices != rhs.completedServices {
                        return lhs.completedServices > rhs.completedServices
                    }
                    return lhs.staffName.compare(rhs.staffName, locale: locale) == .orderedAscending
                }
    }

    private static func rowsById<Row>(_ rows: [Row], id: KeyPath<Row, String?>) -> [String: Row] {
        var map: [String: Row] = [:]
        for row in rows {
            if let key = row[keyPath: id] { map[key] = row }
        }
        return map
    }
}
