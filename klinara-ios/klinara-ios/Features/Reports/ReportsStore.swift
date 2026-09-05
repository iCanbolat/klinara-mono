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

    func loadOccupancy() async {
        occupancy = .loading
        do {
            occupancy = .loaded(
                try await service.occupancy(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    groupBy: occupancyGrouping,
                    compareToPrevious: compareToPrevious
                )
            )
        } catch {
            occupancy = .failed(error as? APIError ?? .network)
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
                    compareToPrevious: compareToPrevious
                )
            )
        } catch {
            revenue = .failed(error as? APIError ?? .network)
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
                    compareToPrevious: compareToPrevious
                )
            )
        } catch {
            staffPerformance = .failed(error as? APIError ?? .network)
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
                    compareToPrevious: compareToPrevious
                )
            )
        } catch {
            noShow = .failed(error as? APIError ?? .network)
        }
    }

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
