import SwiftUI

/// Paket raporlarının durumu (Batch 5.4).
///
/// Üç rapor tek store'da: filtreler (şube ve dönem) ortak ve kullanıcı bir
/// rapordan diğerine geçtiğinde aralığı yeniden seçmek zorunda kalmamalı.
/// Ekran ömürlü — rapor verisi oturum boyunca bellekte tutulacak bir şey değil.
@MainActor
@Observable
final class PackageReportsStore {

    private let service: any PackagesService
    private let clock: BranchClock

    private(set) var outstanding: LoadState<OutstandingReport> = .loading
    private(set) var expiring: LoadState<ExpiringReport> = .loading
    private(set) var usage: LoadState<UsageReport> = .loading

    /// `nil` **tüm şubeler** demek.
    var branchId: String?
    var outstandingGrouping: OutstandingGrouping = .service
    var usageGrouping: UsageGrouping = .service

    /// Dönem başlangıcı — daima ayın ilk günü, şube saatinde.
    var periodStart: Date
    /// Kaç aylık pencere. `to` daima `periodStart + months` ve **hariçtir**.
    var months = 1

    init(service: any PackagesService, clock: BranchClock, branchId: String?) {
        self.service = service
        self.clock = clock
        self.branchId = branchId
        periodStart = clock.startOfMonth(Date())
    }

    /// Yarı açık aralığın üst sınırı: `[periodStart, periodEnd)`.
    var periodEnd: Date { clock.adding(months: months, to: periodStart) }

    var periodLabel: String {
        // Üst sınır hariç olduğu için kullanıcıya **bir gün öncesi** gösterilir;
        // "1 Ekim'e kadar" ile "1 Ekim dahil" arasındaki fark rapor okuyan için
        // gerçek bir fark.
        let inclusiveEnd = periodEnd.addingTimeInterval(-1)
        return "\(clock.formatDate(periodStart)) – \(clock.formatDate(inclusiveEnd))"
    }

    func shiftPeriod(by months: Int) {
        periodStart = clock.adding(months: months, to: periodStart)
    }

    // MARK: Yükleme

    func loadOutstanding() async {
        outstanding = .loading
        do {
            outstanding = .loaded(
                try await service.outstandingReport(
                    branchId: branchId,
                    serviceId: nil,
                    groupBy: outstandingGrouping
                )
            )
        } catch {
            outstanding = .failed(error as? APIError ?? .network)
        }
    }

    func loadExpiring() async {
        expiring = .loading
        do {
            expiring = .loaded(
                try await service.expiringReport(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    cursor: nil,
                    limit: nil
                )
            )
        } catch {
            expiring = .failed(error as? APIError ?? .network)
        }
    }

    func loadUsage() async {
        usage = .loading
        do {
            usage = .loaded(
                try await service.usageReport(
                    from: periodStart,
                    to: periodEnd,
                    branchId: branchId,
                    groupBy: usageGrouping
                )
            )
        } catch {
            usage = .failed(error as? APIError ?? .network)
        }
    }
}
