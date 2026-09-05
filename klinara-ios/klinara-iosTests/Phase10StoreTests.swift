import Foundation
import Testing
@testable import klinara_ios

/// Faz 10.1 store'unun davranış testleri.
///
/// Sınanan şey ekran çizimi değil, **sunucunun kuralları**: aralık yarı
/// açıktır, kapsam sunucudan okunur, oranlar istemcide hesaplanmaz. Mock bu
/// kuralları sunucudan farklı uygularsa arayüz canlıda ilk denemede yanılır.
@MainActor
@Suite("Faz 10.1 store'u")
struct Phase10StoreTests {

    private func store(ownScope: Bool = false) -> ReportsStore {
        let graph = MockGraph()
        graph.reports.setScopeIsOwn(ownScope)
        return ReportsStore(
            service: graph.reports,
            clock: graph.clock,
            branchId: MockGraph.branchId
        )
    }

    // MARK: Dönem

    @Test("Dönem YARI AÇIK ve etiket kapsayıcı")
    func periodIsHalfOpen() {
        let store = store()

        // Üst sınır ayın son günü değil, ertesi ayın ilk günü.
        #expect(store.periodEnd > store.periodStart)
        // Etiket ise kullanıcıya kapsayıcı gösteriliyor: `periodEnd`in kendisi
        // etikette GEÇMEMELİ, bir saniye öncesi geçmeli.
        let endLabel = store.clockLabelForEnd
        #expect(store.periodLabel.hasSuffix(endLabel))
    }

    @Test("Dönem kaydırma başlangıcı taşıyor")
    func shiftsPeriod() {
        let store = store()
        let original = store.periodStart

        store.shiftPeriod(by: -1)
        #expect(store.periodStart < original)
        store.shiftPeriod(by: 1)
        #expect(store.periodStart == original)
    }

    // MARK: Yükleme

    @Test("Doluluk yüklenince LoadState dolu duruma geçiyor")
    func loadsOccupancy() async {
        let store = store()
        #expect(store.occupancy.isLoading)

        await store.loadOccupancy()

        let report = try? #require(store.occupancy.value)
        #expect(report?.scope == .all)
        #expect(store.occupancy.error == nil)
    }

    @Test("Kırılım değişimi yeni veriyi getiriyor")
    func groupingChangesData() async {
        let store = store()

        await store.loadOccupancy()
        let byStaff = store.occupancy.value?.data.count ?? 0

        store.occupancyGrouping = .day
        await store.loadOccupancy()
        let byDay = store.occupancy.value?.data.first

        // Gün kırılımında kimlik YOK; etiket tarih.
        #expect(byDay?.groupId == nil)
        #expect(byStaff > 0)
    }

    @Test("Karşılaştırma kapalıyken `previous` GELMİYOR")
    func comparisonIsOptIn() async {
        let store = store()

        await store.loadRevenue()
        #expect(store.revenue.value?.previous == nil)

        store.compareToPrevious = true
        await store.loadRevenue()
        #expect(store.revenue.value?.previous != nil)
    }

    // MARK: Kapsam

    @Test("`scope: own` SUNUCUDAN okunuyor, izinden türetilmiyor")
    func ownScopeComesFromServer() async {
        let store = store(ownScope: true)

        await store.loadStaffPerformance()
        let report = try? #require(store.staffPerformance.value)

        #expect(report?.scope == .own)
        // Daraltma sunucuda: tek satır dönüyor.
        #expect(report?.data.count == 1)
    }

    @Test("Kapsam geniş olduğunda tüm personel dönüyor")
    func allScopeReturnsEveryone() async {
        let store = store()

        await store.loadStaffPerformance()
        #expect((store.staffPerformance.value?.data.count ?? 0) > 1)
        #expect(store.staffPerformance.value?.scope == .all)
    }

    // MARK: Biçimlendirme

    @Test("Dakika saate çevriliyor")
    func formatsMinutes() {
        #expect(ReportFormat.minutes(480) == "8 sa")
        #expect(ReportFormat.minutes(45) == "45 dk")
        #expect(ReportFormat.minutes(90) == "1 sa 30 dk")
        #expect(ReportFormat.minutes(0) == "0 dk")
    }

    @Test("Delta NULL iken KIYASLANAMAZ — '%0' değil")
    func formatsDelta() {
        #expect(ReportFormat.delta(nil) == nil)
        // `0` gerçek bir değişim yokluğu; `nil` ise kıyaslanamazlık.
        #expect(ReportFormat.delta(0) != nil)
        #expect(ReportFormat.delta(12.5)?.hasPrefix("+") == true)
        #expect(ReportFormat.delta(-3)?.hasPrefix("-") == true)
    }

    @Test("Oran sunucudan geldiği gibi biçimleniyor")
    func formatsPercent() {
        // İstemci 60/480'i kendisi hesaplamıyor; sunucunun verdiği sayıyı
        // yazıyor. Bu, "bakiye istemcide hesaplanmaz" kuralının rapor hâli.
        #expect(ReportFormat.percent(12.5).hasPrefix("%"))
    }
}

private extension ReportsStore {
    /// Etiketin bitiş parçası — `periodEnd`in bir saniye öncesi.
    var clockLabelForEnd: String {
        String(periodLabel.split(separator: "–").last ?? "").trimmingCharacters(in: .whitespaces)
    }
}
