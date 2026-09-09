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

    /// Süre dolumu raporunda bir sayfa yolda mı. Üç rapordan yalnız bu
    /// sayfalanıyor: diğer ikisi gruplanmış toplam döndürüyor ve satır sayısı
    /// grup sayısıyla sınırlı.
    private(set) var isLoadingMoreExpiring = false

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

    /// İmleç yanıtın içinde taşınıyor (``ExpiringReport/pageInfo``), ayrı bir
    /// alanda değil: sayfa ile imlecin ayrı yerlerde durması, birini
    /// güncelleyip diğerini unutmaya açık kapı bırakırdı.
    var canLoadMoreExpiring: Bool { expiring.value?.pageInfo.nextCursor != nil }

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

    /// Sonraki sayfa. İmleç yoksa ya da bir sayfa zaten yolda ise hiçbir şey
    /// yapmaz — liste sonundaki tetikleyici birden çok kez çizilebiliyor.
    ///
    /// Sayfa hatası elde olan satırları **düşürmez**: yarım bir liste, hiç
    /// liste olmamasından iyidir ve kullanıcı kaydırarak tekrar dener.
    func loadMoreExpiring() async {
        guard let current = expiring.value,
              let cursor = current.pageInfo.nextCursor,
              !isLoadingMoreExpiring
        else { return }

        isLoadingMoreExpiring = true
        defer { isLoadingMoreExpiring = false }
        do {
            let page = try await service.expiringReport(
                from: periodStart,
                to: periodEnd,
                branchId: branchId,
                cursor: cursor,
                limit: nil
            )
            expiring = .loaded(ExpiringReport(
                data: current.data + page.data,
                pageInfo: page.pageInfo
            ))
        } catch {
            // Yutuluyor: yeniden deneme kaydırmanın kendisi.
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
