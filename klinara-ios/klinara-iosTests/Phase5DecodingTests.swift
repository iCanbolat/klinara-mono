import Foundation
import Testing
@testable import klinara_ios

/// Faz 5 sözleşmesinin çözümleme testleri.
///
/// Hepsi ``Fixtures`` içindeki **gerçek sunucu gövdeleriyle** çalışır: elle
/// kurulmuş bir model, alan adı ayrıştığında sessiz kalırdı.
@Suite("Faz 5 çözümleme")
struct Phase5DecodingTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test("Paket tanımı kalemleriyle çözülür ve indirim hesabı doğrudur")
    func decodesPackageDefinition() throws {
        let definition = try decode(PackageDefinition.self, Fixtures.packageDefinition)

        #expect(definition.slug == "lazer-10-seans")
        // `null` branchId "tüm şubeler" demek, eksik veri değil.
        #expect(definition.branchId == nil)
        #expect(definition.deletedAt == nil)
        #expect(definition.isArchived == false)
        #expect(definition.items.count == 2)
        #expect(definition.totalSessions == 12)
        // Satış fiyatı liste toplamından yüksek: indirim YOK.
        #expect(definition.discountMinor == nil)
        #expect(definition.discountPercent == nil)
    }

    @Test("Tanım sayfası zarfı ve pageInfo çözülür")
    func decodesDefinitionPage() throws {
        let page = try decode(Page<PackageDefinition>.self, Fixtures.packageDefinitionPage)

        #expect(!page.data.isEmpty)
        #expect(page.pageInfo.hasMore == false)
    }

    @Test("Müşteri paketi kalemleri ve null alanlarıyla çözülür")
    func decodesCustomerPackage() throws {
        let pkg = try decode(CustomerPackage.self, Fixtures.customerPackage)

        #expect(pkg.status == .active)
        #expect(pkg.items.count == 2)
        #expect(pkg.remainingSessions == pkg.items.reduce(0) { $0 + $1.remainingSessions })
        // Faz 6'ya bırakılan alanlar bu aşamada daima null geliyor.
        #expect(pkg.refundSettlementStatus == nil)
        #expect(pkg.refundedAt == nil)
        #expect(pkg.transferredFromPackageId == nil)
        // Yükümlülük kalemlerin toplamı; sayaçtan değil tahsisten türetiliyor.
        #expect(pkg.outstandingMinor == pkg.items.reduce(0) { $0 + $1.outstandingMinor })
    }

    @Test("Müşteri paketi sayfası çözülür")
    func decodesCustomerPackagePage() throws {
        let page = try decode(Page<CustomerPackage>.self, Fixtures.customerPackagePage)
        #expect(page.data.count == 1)
    }

    @Test("Defter satırları çözülür; gerekçe yalnız düzeltmede dolu")
    func decodesLedger() throws {
        let page = try decode(Page<PackageLedgerEntry>.self, Fixtures.packageLedgerPage)

        #expect(page.data.count >= 3)
        let purchases = page.data.filter { $0.entryType == .purchase }
        #expect(purchases.count == 2)
        #expect(purchases.allSatisfy { $0.delta > 0 })

        let adjustment = page.data.first { $0.entryType == .manualAdjustment }
        #expect(adjustment?.reason?.isEmpty == false)
        #expect(adjustment?.delta == -1)
        #expect(adjustment?.signedDelta == "-1")
        #expect(purchases.first?.signedDelta.hasPrefix("+") == true)
        #expect(page.data.allSatisfy { !$0.isReversal })
    }

    @Test("Bilinmeyen defter türü .unknown'a düşer, çözümleme patlamaz")
    func unknownLedgerTypeFallsBack() throws {
        // Sunucu bir gün yeni bir tür eklediğinde eski istemci paket detayını
        // hâlâ açabilmeli; satır "adlandırılamayan işlem" olarak görünür.
        let json = """
        {
          "id": "00000000-0000-4000-8000-000000000001",
          "customerPackageItemId": "00000000-0000-4000-8000-000000000002",
          "serviceId": "00000000-0000-4000-8000-000000000003",
          "serviceName": "Bölgesel Lazer",
          "entryType": "gift_bonus",
          "delta": 2,
          "appointmentId": null,
          "actorUserId": null,
          "reason": null,
          "reversesEntryId": null,
          "createdAt": "2026-08-28T07:50:06.015Z"
        }
        """
        let entry = try decode(PackageLedgerEntry.self, json)
        #expect(entry.entryType == .unknown)
        #expect(entry.signedDelta == "+2")
    }

    @Test("Kullanılabilir haklar ÇIPLAK dizi olarak çözülür")
    func decodesEntitlements() throws {
        // Zarf beklemek burada çalışma anında patlardı: bu uç `{ "data": ... }`
        // döndürmüyor, müşteri aramasıyla aynı istisna.
        let entitlements = try decode([PackageEntitlement].self, Fixtures.packageEntitlements)

        #expect(entitlements.count == 2)
        #expect(entitlements.first?.id == entitlements.first?.customerPackageItemId)
        #expect(entitlements.allSatisfy { $0.remainingSessions > 0 })
    }

    @Test("Yükümlülük raporu toplamlarıyla çözülür")
    func decodesOutstandingReport() throws {
        let report = try decode(OutstandingReport.self, Fixtures.outstandingReport)

        #expect(report.totals.currency == "TRY")
        #expect(report.data.reduce(0) { $0 + $1.outstandingMinor } == report.totals.outstandingMinor)
    }

    @Test("Süre dolumu raporu çözülür; parasal alan opsiyoneldir")
    func decodesExpiringReport() throws {
        let report = try decode(ExpiringReport.self, Fixtures.expiringReport)
        #expect(report.data.count == 1)

        // İzinsiz kullanıcıda alan hiç gelmiyor; `nil` ile sıfır aynı şey değil.
        let withoutAmount = """
        {
          "data": [
            {
              "customerPackageId": "00000000-0000-4000-8000-000000000001",
              "customerId": "00000000-0000-4000-8000-000000000002",
              "customerName": "Ayşe Yılmaz",
              "packageName": "10 Seans Lazer",
              "branchId": "00000000-0000-4000-8000-000000000003",
              "remainingSessions": 4,
              "expiresAt": "2026-10-01T00:00:00.000Z"
            }
          ],
          "pageInfo": { "nextCursor": null, "hasMore": false }
        }
        """
        let restricted = try decode(ExpiringReport.self, withoutAmount)
        #expect(restricted.data.first?.outstandingMinor == nil)
    }

    @Test("Dönem kullanım raporu çözülür")
    func decodesUsageReport() throws {
        let report = try decode(UsageReport.self, Fixtures.usageReport)
        #expect(!report.data.isEmpty)
        #expect(report.data.contains { $0.purchased > 0 })
    }

    @Test("PACKAGE_EXHAUSTED kodu tanınır ve Türkçe mesajı vardır")
    func decodesExhaustedProblem() throws {
        let problem = try decode(ProblemDetails.self, Fixtures.packageExhausted)

        #expect(problem.code == .packageExhausted)
        #expect(problem.status == 409)
        let error = APIError.problem(problem)
        #expect(error.displayMessage.contains("Paket hakkı yetersiz"))
        // Randevu tamamlanmadı bilgisi mesajda olmalı: kullanıcı seansın
        // düştüğünü sanmamalı.
        #expect(error.displayMessage.contains("tamamlanmadı"))
        #expect(!error.isFieldScoped)
    }

    @Test("Randevu yanıtı bağlı paket kalemini taşır")
    func decodesAppointmentPackageBinding() throws {
        let appointment = try decode(Appointment.self, Fixtures.appointmentWithPackage)
        let line = appointment.services.first

        #expect(line?.customerPackageItemId != nil)
    }

    @Test("Paketsiz randevuda alan nil'dir")
    func decodesAppointmentWithoutPackage() throws {
        let appointment = try decode(Appointment.self, Fixtures.appointment)
        #expect(appointment.services.first?.customerPackageItemId == nil)
    }
}
