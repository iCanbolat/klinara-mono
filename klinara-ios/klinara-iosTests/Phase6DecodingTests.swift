import Foundation
import Testing
@testable import klinara_ios

/// Faz 6 sözleşmesinin çözümleme testleri.
///
/// Hepsi ``Fixtures`` içindeki **gerçek sunucu gövdeleriyle** çalışır (tek
/// istisna `chargeUnknownSource`, sebebi orada yazılı): elle kurulmuş bir
/// model, alan adı ayrıştığında sessiz kalırdı.
@Suite("Faz 6 çözümleme")
struct Phase6DecodingTests {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Ücret kalemi

    @Test("Ücret kalemi çözülür; KDV fiyata dahil ve net + KDV = brüt")
    func decodesCharge() throws {
        let charge = try decode(Charge.self, Fixtures.charge)

        #expect(charge.source == .product)
        #expect(charge.status == .open)
        #expect(charge.quantity == 2)
        #expect(charge.discountKind == .percent)
        #expect(charge.discountValue == 1500)
        #expect(charge.discountMinor == 13_500)
        // Fazın en kritik aritmetik kuralı: KDV brütün İÇİNDEN çıkıyor.
        #expect(charge.netMinor + charge.vatMinor == charge.totalMinor)
        #expect(charge.totalMinor == 76_500)
        #expect(charge.vatMinor == 12_750)
        // Liste 50.000, satış 45.000 → override var ve gerekçesi dolu.
        #expect(charge.isPriceOverridden)
        #expect(charge.priceOverrideReason != nil)
        #expect(charge.voidedAt == nil)
    }

    @Test("Kalem sayfasında randevu kaynaklı kalem null indirimle çözülür")
    func decodesChargePage() throws {
        let page = try decode(Page<Charge>.self, Fixtures.chargePage)

        #expect(page.data.count == 2)
        #expect(page.pageInfo.hasMore == false)

        let automatic = try #require(page.data.first { $0.source == .appointmentService })
        // Randevu kalemi OTOMATİK doğdu: bağı dolu, indirim alanları null.
        #expect(automatic.appointmentServiceId != nil)
        #expect(automatic.discountId == nil)
        #expect(automatic.discountKind == nil)
        #expect(automatic.discountValue == nil)
        // Liste = satış olduğu için override yok; gerekçe aranmamalı.
        #expect(!automatic.isPriceOverridden)
    }

    @Test("Bilinmeyen kalem kaynağı unknown'a düşer, çözümleme patlamaz")
    func decodesUnknownChargeSource() throws {
        let charge = try decode(Charge.self, Fixtures.chargeUnknownSource)

        #expect(charge.source == .unknown)
        #expect(charge.source.turkishName == "Bilinmeyen kalem")
        // Kalan alanlar okunabiliyor: bilinmeyen bir kaynak satırı yutmaz.
        #expect(charge.totalMinor == 50_000)
    }

    // MARK: Cari hesap

    @Test("Cari hesap toplamları satırlarla tutar; tahsilat negatif gelir")
    func decodesAccount() throws {
        let account = try decode(CustomerAccount.self, Fixtures.account)

        #expect(account.chargedMinor == 126_500)
        #expect(account.paidMinor == 30_000)
        #expect(account.balanceMinor == 96_500)
        #expect(account.balanceMinor == account.chargedMinor - account.paidMinor)
        #expect(!account.hasCredit)
        #expect(!account.isSettled)

        // Satırların toplamı bakiyeye eşit: borç pozitif, alacak negatif.
        #expect(account.entries.reduce(0) { $0 + $1.amountMinor } == account.balanceMinor)

        let payment = try #require(account.entries.first { $0.entryKind == .payment })
        #expect(payment.amountMinor == -30_000)
        // `entrySource` tahsilatta YÖNTEM, kalemde KAYNAK — tek enum'a
        // zorlanamayacağı için ham metin taşınıyor.
        #expect(payment.entrySource == "cash")

        let charge = try #require(account.entries.first { $0.entrySource == "appointment_service" })
        #expect(charge.entryKind == .charge)
        #expect(charge.amountMinor > 0)
    }

    // MARK: Tahsilat

    @Test("Tahsilat otomatik dağıtımla çözülür; makbuz numarası dolu")
    func decodesPayment() throws {
        let payment = try decode(Payment.self, Fixtures.payment)

        #expect(payment.method == .cash)
        #expect(payment.status == .posted)
        #expect(payment.receiptNo == 1)
        #expect(payment.cashSessionId != nil)
        #expect(payment.allocatedMinor + payment.unallocatedMinor == payment.amountMinor)
        #expect(!payment.hasAdvance)
        // Tahsis verilmemişti: sunucu en ESKİ açık kaleme yazdı.
        #expect(payment.allocations.count == 1)
        #expect(payment.allocations[0].chargeDescription == "Bölgesel Lazer")
        #expect(payment.allocations[0].amountMinor == 30_000)
    }

    @Test("İptal edilen tahsilatta tahsis satırları SİLİNMEZ")
    func decodesVoidedPayment() throws {
        let payment = try decode(Payment.self, Fixtures.paymentVoided)

        #expect(payment.status == .void)
        #expect(payment.voidedAt != nil)
        #expect(payment.voidedReason == "Yanlış müşteriye kaydedildi")
        // Kritik: bakiye geri geldi ama makbuzun neyi kapattığı duruyor.
        #expect(payment.allocations.count == 1)
        #expect(payment.allocatedMinor == 30_000)
        #expect(payment.version == 2)
    }

    @Test("Tahsilat sayfası çözülür")
    func decodesPaymentPage() throws {
        let page = try decode(Page<Payment>.self, Fixtures.paymentPage)

        #expect(!page.data.isEmpty)
        #expect(page.pageInfo.hasMore == false)
    }

    // MARK: Kasa

    @Test("Açık kasada expected/counted/difference null gelir")
    func decodesOpenCashSession() throws {
        let session = try decode(CashSession.self, Fixtures.cashSessionOpen)

        #expect(session.status == .open)
        #expect(session.isOpen)
        #expect(session.closedAt == nil)
        // Üçü de kapanışta hesaplanıyor; açık oturumda null olmaları normal.
        #expect(session.expectedMinor == nil)
        #expect(session.countedMinor == nil)
        #expect(session.differenceMinor == nil)
        #expect(!session.hasDifference)
    }

    @Test("Farklı kapanışta fark ve gerekçe dolu gelir")
    func decodesClosedCashSession() throws {
        let session = try decode(CashSession.self, Fixtures.cashSessionClosed)

        #expect(session.status == .closed)
        #expect(session.closedAt != nil)
        #expect(session.expectedMinor == 75_000)
        #expect(session.countedMinor == 70_000)
        #expect(session.differenceMinor == -5_000)
        #expect(session.hasDifference)
        // Fark varsa gerekçe ZORUNLU; sunucu gerekçesiz kapanışı reddediyor.
        #expect(session.differenceReason == "Bozuk para farkı")
    }

    @Test("Kasa özeti: beklenen tutar yalnız nakit hareketlerden doğar")
    func decodesCashSummary() throws {
        let summary = try decode(CashSessionSummary.self, Fixtures.cashSummary)

        #expect(summary.session.isOpen)
        #expect(summary.expectedMinor == 80_000)
        // Hareketlerin toplamı beklenen tutara eşit: 50.000 açılış + 30.000.
        #expect(summary.movements.reduce(0) { $0 + $1.amountMinor } == summary.expectedMinor)
        #expect(summary.movements.map(\.kind) == [.opening, .payment])

        let cash = try #require(summary.byMethod.first { $0.method == .cash })
        #expect(cash.amountMinor == 30_000)
        #expect(cash.count == 1)

        // Sayım tutmazsa fark burada hesaplanıyor — kapatmadan ÖNCE.
        #expect(summary.difference(counted: 75_000) == -5_000)
        #expect(summary.difference(counted: 80_000) == 0)
    }

    @Test("Kasa sayfası çözülür")
    func decodesCashSessionPage() throws {
        let page = try decode(Page<CashSession>.self, Fixtures.cashSessionPage)

        #expect(!page.data.isEmpty)
    }

    @Test("İade pozitif tutarla çözülür; paket mutabakatı null")
    func decodesRefund() throws {
        let refund = try decode(Refund.self, Fixtures.refund)

        #expect(refund.kind == .service)
        #expect(refund.method == .cash)
        // Tutar POZİTİF taşınıyor; yön `kind` ile belli.
        #expect(refund.amountMinor == 5_000)
        #expect(refund.cashSessionId != nil)
        #expect(refund.customerPackageId == nil)
        #expect(refund.packageSettlementStatus == nil)
    }

    // MARK: İndirim

    @Test("İndirim baz puanla çözülür ve seçilebilirliği doğru hesaplanır")
    func decodesDiscount() throws {
        let discount = try decode(Discount.self, Fixtures.discount)

        #expect(discount.code == "YAZ2026")
        #expect(discount.kind == .percent)
        // 1500 baz puan = %15; ekranda yüzde gösteriliyor.
        #expect(discount.value == 1500)
        #expect(discount.valueLabel == "%15")
        #expect(discount.startsAt == nil)
        #expect(discount.endsAt == nil)
        #expect(discount.isSelectable())

        // Hak tükenirse seçilemez — sunucu da `DISCOUNT_INVALID` verirdi.
        #expect(discount.redeemedCount < (discount.maxRedemptions ?? .max))
    }

    @Test("İndirim sayfası çözülür")
    func decodesDiscountPage() throws {
        let page = try decode(Page<Discount>.self, Fixtures.discountPage)

        #expect(!page.data.isEmpty)
    }

    // MARK: Prim

    @Test("Prim kuralı çözülür; effectiveFrom tarih olarak taşınır")
    func decodesCommissionRule() throws {
        let rule = try decode(CommissionRule.self, Fixtures.commissionRule)

        #expect(rule.scope == .global)
        #expect(rule.scopeRefId == nil)
        #expect(rule.staffProfileId == nil)
        #expect(rule.calcKind == .percent)
        #expect(rule.value == 1000)
        #expect(rule.valueLabel == "%10")
        #expect(rule.basis == .netAfterDiscount)
        #expect(rule.triggerOn == .serviceCompleted)
        // `YYYY-MM-DD` — timestamp DEĞİL; `Date` olarak yazılsaydı çözücünün
        // ISO 8601 stratejisi bu gövdeyi reddederdi.
        #expect(rule.effectiveFrom == "2026-01-01")
        #expect(rule.effectiveTo == nil)
    }

    @Test("Prim kuralı sayfası çözülür")
    func decodesCommissionRulePage() throws {
        let page = try decode(Page<CommissionRule>.self, Fixtures.commissionRulePage)

        #expect(!page.data.isEmpty)
    }

    @Test("Tahakkuk çözülür; ters kayıt değilse reversesAccrualId null")
    func decodesAccrual() throws {
        let page = try decode(Page<CommissionAccrual>.self, Fixtures.commissionAccrualPage)
        let accrual = try #require(page.data.first)

        #expect(accrual.triggerOn == .serviceCompleted)
        #expect(accrual.ruleBasis == .netAfterDiscount)
        #expect(accrual.basisMinor == 50_000)
        // %10 → 5.000; matrahtan hesaplandığı ekranda da görünüyor.
        #expect(accrual.amountMinor == 5_000)
        #expect(accrual.chargeId != nil)
        #expect(accrual.paymentId == nil)
        #expect(!accrual.isReversal)
    }

    @Test("Dönem listesi ÇIPLAK DİZİ olarak çözülür, zarf yok")
    func decodesPeriodsAsBareArray() throws {
        // Zarf beklemek burada sessiz bir hataya dönüşürdü: uç `{ data: … }`
        // döndürmüyor ve `Page` ile çözmeye çalışmak patlardı.
        let periods = try decode([CommissionPeriod].self, Fixtures.commissionPeriods)

        #expect(periods.count == 1)
        #expect(periods[0].status == .open)
        #expect(!periods[0].isClosed)
        #expect(periods[0].startsOn == "2026-08-01")
        #expect(periods[0].endsOn == "2026-08-31")
        #expect(periods[0].rangeLabel == "2026-08-01 – 2026-08-31")
        #expect(periods[0].closedAt == nil)
    }

    @Test("Kapatılan dönemde closedAt dolu ve sürüm artmış olur")
    func decodesClosedPeriod() throws {
        let period = try decode(CommissionPeriod.self, Fixtures.commissionPeriodClosed)

        #expect(period.status == .closed)
        #expect(period.isClosed)
        #expect(period.closedAt != nil)
        #expect(period.version == 2)
    }

    @Test("Prim raporu toplamı satırlarla tutar")
    func decodesCommissionReport() throws {
        let report = try decode(CommissionReport.self, Fixtures.commissionReport)

        #expect(report.rows.count == 1)
        #expect(report.rows[0].staffName == "Demo Uygulayıcı")
        #expect(report.rows[0].accrualCount == 1)
        #expect(report.totalMinor == report.rows.reduce(0) { $0 + $1.amountMinor })
        #expect(report.currency == "TRY")
    }

    // MARK: Hata gövdeleri

    @Test("Faz 6 hata kodları tanınır ve kullanıcı mesajı üretilir")
    func decodesFinanceProblems() throws {
        let cases: [(String, APIErrorCode)] = [
            (Fixtures.cashSessionRequiredProblem, .cashSessionRequired),
            (Fixtures.cashSessionAlreadyOpenProblem, .cashSessionAlreadyOpen),
            (Fixtures.paymentExceedsBalanceProblem, .paymentExceedsBalance),
            (Fixtures.discountInvalidProblem, .discountInvalid),
            (Fixtures.periodClosedProblem, .periodClosed),
        ]

        for (json, expected) in cases {
            let problem = try decode(ProblemDetails.self, json)
            #expect(problem.code == expected)
            #expect(problem.status == 409)

            let error = APIError.problem(problem)
            // Genel "bir sorun oluştu" cümlesine DÜŞMEMELİ: bu kodların her
            // biri kullanıcıya farklı bir düzeltme söylüyor.
            #expect(error.displayMessage != "Bir sorun oluştu. Lütfen tekrar deneyin.")
            #expect(!error.isRetryable)
        }
    }

    @Test("PERIOD_CLOSED gövdesinde detail yok; mesaj yine de üretilir")
    func periodClosedHasNoDetail() throws {
        let problem = try decode(ProblemDetails.self, Fixtures.periodClosedProblem)

        #expect(problem.detail == nil)
        // Sunucunun `detail`i olmadan da anlamlı bir cümle çıkması gerekiyor;
        // `problem.detail ?? title` yazılsaydı kullanıcı sunucu başlığını görürdü.
        #expect(APIError.problem(problem).displayMessage.contains("dönem"))
    }
}
