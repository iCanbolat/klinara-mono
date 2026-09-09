import SwiftUI

/// Batch 10.1 raporlarının durumu.
///
/// Beş rapor tek store'da: filtreler (şube, dönem, karşılaştırma) ORTAK ve
/// kullanıcı bir rapordan diğerine geçtiğinde aralığı yeniden seçmek zorunda
/// kalmamalı. `PackageReportsStore`un kararının aynısı.
///
/// Ekran ömürlü — rapor verisi oturum boyunca bellekte tutulacak bir şey değil
/// ve şube değişiminde tamamen yeniden kuruluyor.
@MainActor
@Observable
final class ReportsStore {

    private let service: any ReportsService
    private let clock: BranchClock

    private(set) var occupancy: LoadState<OccupancyReport> = .loading
    private(set) var revenue: LoadState<RevenueReport> = .loading
    private(set) var staffPerformance: LoadState<StaffPerformanceReport> = .loading
    private(set) var noShow: LoadState<NoShowReport> = .loading
    private(set) var retention: LoadState<RetentionReport> = .loading

    /// `nil` **tüm şubeler** demek.
    var branchId: String?
    var occupancyGrouping: OccupancyGrouping = .staff
    var revenueGrouping: RevenueGrouping = .service
    var noShowGrouping: NoShowGrouping = .staff
    var compareToPrevious = false

    /// Dönem başlangıcı — daima ayın ilk günü, şube saatinde.
    var periodStart: Date
    /// Kaç aylık pencere. `to` daima `periodStart + months` ve **hariçtir**.
    var months = 1

    /// Kırılım satırlarının sayfa boyutu.
    ///
    /// Sayfalama olmadan `groupBy=day` ile 12 aylık bir rapor 365 satırı tek
    /// yanıtta telefona indiriyordu. Sunucu tarafında sayfalama **opt-in**;
    /// mobil istemci onu açıyor, web yönetim paneli açmıyor.
    static let pageSize = 50

    private(set) var isLoadingMore = false

    init(service: any ReportsService, clock: BranchClock, branchId: String?) {
        self.service = service
        self.clock = clock
        self.branchId = branchId
        periodStart = clock.startOfMonth(Date())
    }

    /// Yarı açık aralığın üst sınırı: `[periodStart, periodEnd)`.
    var periodEnd: Date { clock.adding(months: months, to: periodStart) }

    var periodLabel: String {
        // Üst sınır hariç olduğu için kullanıcıya BİR GÜN ÖNCESİ gösteriliyor;
        // "1 Ekim'e kadar" ile "1 Ekim dahil" arasındaki fark rapor okuyan için
        // gerçek bir fark.
        let inclusiveEnd = periodEnd.addingTimeInterval(-1)
        return "\(clock.formatDate(periodStart)) – \(clock.formatDate(inclusiveEnd))"
    }

    func shiftPeriod(by months: Int) {
        periodStart = clock.adding(months: months, to: periodStart)
    }

    // MARK: Yükleme

    /// İlk sayfa. Beş `loadX` de aynı deseni izliyor: durum sıfırlanır, ilk
    /// sayfa çekilir; sonraki sayfalar ``appendPage(into:existing:fetch:)``
    /// üzerinden **satır ekleyerek** gelir, toplamlar ilk sayfadakinde kalır.
    func loadOccupancy() async {
        occupancy = .loading
        do {
            occupancy = .loaded(
                try await service.occupancy(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    groupBy: occupancyGrouping,
                    compareToPrevious: compareToPrevious,
                    page: ReportPageQuery(limit: Self.pageSize)
                )
            )
        } catch {
            occupancy = .failed(error as? APIError ?? .network)
        }
    }

    var canLoadMoreOccupancy: Bool { occupancy.value?.pageInfo?.nextCursor != nil }

    func loadMoreOccupancy() async {
        await appendPage(current: occupancy.value, cursor: \.pageInfo?.nextCursor) { cursor in
            let next = try await service.occupancy(
                from: periodStart,
                to: periodEnd,
                branchId: branchId,
                groupBy: occupancyGrouping,
                compareToPrevious: compareToPrevious,
                page: ReportPageQuery(limit: Self.pageSize, cursor: cursor)
            )
            guard let current = occupancy.value else { return }
            occupancy = .loaded(OccupancyReport(
                scope: current.scope,
                period: current.period,
                // Toplamlar İLK sayfadakinde kalıyor: sunucu onları aralığın
                // tamamından hesaplıyor ve sayfa değiştikçe oynamamalı.
                totals: current.totals,
                data: current.data + next.data,
                pageInfo: next.pageInfo,
                previous: current.previous,
                delta: current.delta
            ))
        }
    }

    func loadRevenue() async {
        revenue = .loading
        do {
            revenue = .loaded(
                try await service.revenue(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    groupBy: revenueGrouping,
                    compareToPrevious: compareToPrevious,
                    page: ReportPageQuery(limit: Self.pageSize)
                )
            )
        } catch {
            revenue = .failed(error as? APIError ?? .network)
        }
    }

    var canLoadMoreRevenue: Bool { revenue.value?.pageInfo?.nextCursor != nil }

    func loadMoreRevenue() async {
        await appendPage(current: revenue.value, cursor: \.pageInfo?.nextCursor) { cursor in
            let next = try await service.revenue(
                from: periodStart,
                to: periodEnd,
                branchId: branchId,
                groupBy: revenueGrouping,
                compareToPrevious: compareToPrevious,
                page: ReportPageQuery(limit: Self.pageSize, cursor: cursor)
            )
            guard let current = revenue.value else { return }
            revenue = .loaded(RevenueReport(
                scope: current.scope,
                period: current.period,
                totals: current.totals,
                data: current.data + next.data,
                pageInfo: next.pageInfo,
                previous: current.previous,
                delta: current.delta
            ))
        }
    }

    func loadStaffPerformance() async {
        staffPerformance = .loading
        do {
            staffPerformance = .loaded(
                try await service.staffPerformance(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    compareToPrevious: compareToPrevious,
                    page: ReportPageQuery(limit: Self.pageSize)
                )
            )
        } catch {
            staffPerformance = .failed(error as? APIError ?? .network)
        }
    }

    var canLoadMoreStaffPerformance: Bool {
        staffPerformance.value?.pageInfo?.nextCursor != nil
    }

    func loadMoreStaffPerformance() async {
        await appendPage(current: staffPerformance.value, cursor: \.pageInfo?.nextCursor) { cursor in
            let next = try await service.staffPerformance(
                from: periodStart,
                to: periodEnd,
                branchId: branchId,
                compareToPrevious: compareToPrevious,
                page: ReportPageQuery(limit: Self.pageSize, cursor: cursor)
            )
            guard let current = staffPerformance.value else { return }
            staffPerformance = .loaded(StaffPerformanceReport(
                scope: current.scope,
                period: current.period,
                data: current.data + next.data,
                pageInfo: next.pageInfo,
                currency: current.currency
            ))
        }
    }

    func loadNoShow() async {
        noShow = .loading
        do {
            noShow = .loaded(
                try await service.noShow(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    groupBy: noShowGrouping,
                    compareToPrevious: compareToPrevious,
                    page: ReportPageQuery(limit: Self.pageSize)
                )
            )
        } catch {
            noShow = .failed(error as? APIError ?? .network)
        }
    }

    var canLoadMoreNoShow: Bool { noShow.value?.pageInfo?.nextCursor != nil }

    func loadMoreNoShow() async {
        await appendPage(current: noShow.value, cursor: \.pageInfo?.nextCursor) { cursor in
            let next = try await service.noShow(
                from: periodStart,
                to: periodEnd,
                branchId: branchId,
                groupBy: noShowGrouping,
                compareToPrevious: compareToPrevious,
                page: ReportPageQuery(limit: Self.pageSize, cursor: cursor)
            )
            guard let current = noShow.value else { return }
            noShow = .loaded(NoShowReport(
                period: current.period,
                totals: current.totals,
                data: current.data + next.data,
                pageInfo: next.pageInfo,
                // `byOrigin` sayfalanmıyor (iki satır); ilk sayfadaki geçerli.
                byOrigin: current.byOrigin,
                previous: current.previous,
                delta: current.delta
            ))
        }
    }

    /// Geri dönüş raporunun kırılım LİSTESİ YOK: `acquisition` müşteri kaynağı
    /// sayısıyla, `cohorts` üç satırla sınırlı. Sayfalamak, olmayan bir
    /// listeye sayfa numarası vermek olurdu.
    func loadRetention() async {
        retention = .loading
        do {
            retention = .loaded(
                try await service.retention(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    compareToPrevious: compareToPrevious
                )
            )
        } catch {
            retention = .failed(error as? APIError ?? .network)
        }
    }

    // MARK: Sayfalama

    /// Sonraki sayfa ortak sarmalayıcısı.
    ///
    /// Beş rapor aynı üç kuralı paylaşıyor ve beş kez yazmak, birinde
    /// `isLoadingMore`ı unutmak demekti: imleç yoksa hiçbir şey yapma, bir
    /// sayfa yoldayken ikincisini başlatma, sayfa hatasında **eldeki satırları
    /// düşürme** — yarım bir rapor, hiç rapor olmamasından iyi.
    private func appendPage<Report>(
        current: Report?,
        cursor: (Report) -> String?,
        fetch: (String) async throws -> Void
    ) async {
        guard let current, let next = cursor(current), !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        // Yutuluyor: yeniden deneme kaydırmanın kendisi.
        try? await fetch(next)
    }
}

// MARK: - Biçimlendirme

/// Rapor ekranlarının ortak biçimlendiricileri.
///
/// ⚠️ HİÇBİRİ HESAP YAPMIYOR. Oranlar ve toplamlar sunucudan geldiği gibi
/// geliyor; buradaki tek iş onları okunur kılmak.
enum ReportFormat {

    /// Yüzde — sunucu zaten yüzde gönderiyor, yalnız işaret ve ayraç.
    static func percent(_ value: Double) -> String {
        "%\(number(value))"
    }

    /// Dakikayı "8 sa 30 dk" biçimine çevirir.
    ///
    /// Ham dakika (`480`) bir insanın kafasında saate dönüşmüyor ve doluluk
    /// raporu tam da "kaç saatim doluydu" sorusunun cevabı.
    static func minutes(_ total: Int) -> String {
        let hours = total / 60
        let rest = total % 60
        if hours == 0 { return "\(rest) dk" }
        if rest == 0 { return "\(hours) sa" }
        return "\(hours) sa \(rest) dk"
    }

    /// Yüzde değişim. `nil` KIYASLANAMAZ demek — "%0" değil.
    static func delta(_ value: Double?) -> String? {
        guard let value else { return nil }
        return "\(value > 0 ? "+" : "")\(number(value))%"
    }

    private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        return formatter
    }()

    static func number(_ value: Double) -> String {
        formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
