import Foundation
import Testing
@testable import klinara_ios

/// Faz 10.1 sözleşmesi — gövdeler gerçek sunucudan **birebir yakalandı**.
///
/// Elle kurulmuş model örnekleri sözleşmeyi test etmez, yalnız kendi
/// varsayımımızı tekrar eder (Ek F ve Ek L'deki karar).
@Suite("Faz 10.1 çözümleme")
struct Phase10DecodingTests {

    // MARK: Doluluk

    @Test("Doluluk raporu ve karşılaştırma çözülür")
    func decodesOccupancy() throws {
        let report = try Fixtures.decode(OccupancyReport.self, from: ReportFixtures.occupancy)

        #expect(report.scope == .all)
        #expect(report.totals.bookedMinutes == 60)
        #expect(report.totals.availableMinutes == 3240)
        #expect(report.totals.occupancyRate == 1.85)
        #expect(report.data.count == 1)
        #expect(report.previous?.availableMinutes == 3240)
    }

    @Test("`delta` içindeki NULL 'kıyaslanamaz' olarak çözülür")
    func decodesNullDelta() throws {
        let report = try Fixtures.decode(OccupancyReport.self, from: ReportFixtures.occupancy)
        let delta = try #require(report.delta)

        // Önceki dönem sıfırken sunucu `null` gönderiyor ve bu "%0" DEĞİL.
        // `[String: Double?]` çift sarmalı: anahtar var, değeri yok.
        #expect(delta["occupancyRate"] != nil)
        #expect(delta["occupancyRate"] ?? nil == nil)
        // Değişimin gerçekten sıfır olduğu alan ise `0` geliyor.
        #expect(delta["availableMinutes"] ?? nil == 0)
    }

    @Test("Gün kırılımında `groupId` NULL gelir ve etiket tarihtir")
    func decodesOccupancyByDay() throws {
        let report = try Fixtures.decode(OccupancyReport.self, from: ReportFixtures.occupancyByDay)
        let first = try #require(report.data.first)

        #expect(first.groupId == nil)
        // Kimlik yokken `Identifiable` etikete düşüyor; liste yine de kararlı.
        #expect(first.id == first.groupLabel)
        #expect(first.groupLabel.count == 10) // YYYY-MM-DD
    }

    // MARK: Ciro

    /// Personelsiz kalem kırılımda "—" etiketiyle DURUYOR.
    ///
    /// LEFT JOIN olmasaydı satır düşer ve kırılım toplamı genel toplamı
    /// tutmazdı; fixture bunu gerçek bir elle açılmış kalemle yakalıyor.
    @Test("Personelsiz kalem kırılımda kaybolmuyor")
    func decodesUnattributedRow() throws {
        let report = try Fixtures.decode(RevenueReport.self, from: ReportFixtures.revenue)
        let unattributed = try #require(report.data.first { $0.groupId == nil })

        #expect(unattributed.groupLabel == "—")
        #expect(unattributed.accruedMinor == 250_000)
        // Kimliksiz satırın `id`si etikete düşüyor; ForEach kararlı kalıyor.
        #expect(unattributed.id == "—")
    }

    @Test("Ciro raporunda tahakkuk ve tahsilat AYRI çözülür")
    func decodesRevenue() throws {
        let report = try Fixtures.decode(RevenueReport.self, from: ReportFixtures.revenue)

        #expect(report.totals.currency == "TRY")
        // İkisi aynı sayı değil ve olmamalı: fixture'da 350.000 kuruşluk
        // tahakkuk var ama tahsilat 180.000. Raporun en sık yanlış okunan
        // yeri tam olarak bu ayrım.
        #expect(report.totals.accruedMinor == 350_000)
        #expect(report.totals.collectedMinor == 180_000)
        #expect(report.totals.accruedMinor != report.totals.collectedMinor)
    }

    @Test("Ödeme yöntemi kırılımında tahakkuk sıfır")
    func decodesRevenueByMethod() throws {
        let report = try Fixtures.decode(RevenueReport.self, from: ReportFixtures.revenueByMethod)
        let card = try #require(report.data.first { $0.groupLabel == "card" })

        #expect(card.collectedMinor == 180_000)
        // Yöntem bir KALEM özelliği değil; sunucu bu kırılımda tahakkuku
        // bilerek sıfır döndürüyor.
        #expect(card.accruedMinor == 0)
    }

    // MARK: Personel performansı

    @Test("Personel performansı çözülür")
    func decodesStaffPerformance() throws {
        let report = try Fixtures.decode(
            StaffPerformanceReport.self,
            from: ReportFixtures.staffPerformance
        )
        let row = try #require(report.data.first)

        #expect(report.scope == .all)
        #expect(report.currency == "TRY")
        #expect(row.completedServices == 2)
        #expect(row.revenueMinor == 100_000)
    }

    @Test("Uygulayıcının yanıtı `scope: own` taşır")
    func decodesOwnScope() throws {
        let report = try Fixtures.decode(
            StaffPerformanceReport.self,
            from: ReportFixtures.staffPerformanceOwn
        )

        // Rozet BU alandan çiziliyor; istemci izin listesine bakıp tahmin
        // etmiyor. Gövde gerçekten uygulayıcı token'ıyla alındı.
        #expect(report.scope == .own)
        #expect(report.data.count == 1)
    }

    // MARK: Gelmeme

    @Test("Gelmeme oranı ve kaynak kırılımı çözülür")
    func decodesNoShow() throws {
        let report = try Fixtures.decode(NoShowReport.self, from: ReportFixtures.noShow)

        #expect(report.totals.total == 3)
        #expect(report.totals.noShow == 1)
        #expect(report.totals.completed == 2)
        // Oran sunucudan geliyor; istemci 1/3'ü kendisi hesaplamıyor.
        #expect(report.totals.noShowRate == 33.33)

        let internalOrigin = try #require(report.byOrigin.first { $0.origin == "internal" })
        #expect(internalOrigin.total == 3)
        #expect(internalOrigin.turkishName == "Klinikten")
    }

    // MARK: Kazanım

    @Test("Kazanım ve kohort oranları çözülür")
    func decodesRetention() throws {
        let report = try Fixtures.decode(RetentionReport.self, from: ReportFixtures.retention)

        #expect(report.totals.newCustomers == 1)
        #expect(report.totals.activeCustomers == 1)
        #expect(report.cohorts.count == 3)
        #expect(report.cohorts.map(\.withinDays) == [30, 60, 90])
    }

    @Test("Kaynağı girilmemiş müşteri NULL gelir ve etiketlenir")
    func decodesNullAcquisitionSource() throws {
        let report = try Fixtures.decode(RetentionReport.self, from: ReportFixtures.retention)
        let unknown = try #require(report.acquisition.first { $0.source == nil })

        // Kimliksiz satır listede kararlı bir `id` almalı, yoksa ForEach
        // çakışır.
        #expect(unknown.id == "__unknown__")
        #expect(unknown.turkishName == "Belirtilmemiş")
    }

    @Test("Yanıt müşteri KİMLİĞİ taşımıyor")
    func retentionCarriesNoCustomerIds() throws {
        // Rapor toplu bir sayıdır; içinden tek tek müşteriye inilememeli.
        // Sunucu tarafında da bir testle sabitlendi, burada sözleşmenin
        // istemciye ulaşan hâli doğrulanıyor.
        #expect(!ReportFixtures.retention.contains("customerId"))
        #expect(!ReportFixtures.retention.contains("phone"))
    }
}
