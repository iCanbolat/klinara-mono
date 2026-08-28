import Foundation
import Testing
@testable import klinara_ios

/// Faz 6 store'larının ve finans mock'unun davranış testleri.
///
/// Sınanan şey ekran çizimi değil, **paranın kuralları**: bakiyenin nereden
/// geldiği, dağıtımın hangi sırayla yapıldığı, hangi işlemin neden
/// reddedildiği. Mock bu kuralları sunucudan farklı uygularsa arayüz canlıda
/// ilk denemede yanılır — Faz 5'te ``MockPackagesService`` için verilen kararın
/// aynısı.
@MainActor
@Suite("Faz 6 store'ları")
struct Phase6StoreTests {

    private func graph() -> MockGraph { MockGraph() }

    private func accountStore(_ mock: MockGraph) -> CustomerAccountStore {
        CustomerAccountStore(customerId: MockCustomerSeed.ayse, service: mock.finance)
    }

    /// Tohumda Ayşe'nin 165.000 borcu ve 80.000 tahsilatı var → 85.000 bakiye.
    private let seededBalance = 85_000

    // MARK: Cari hesap

    @Test("Bakiye = açık kalemler − tahsilatlar; ayrıca saklanmaz")
    func balanceIsDerived() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let account = try #require(store.account)
        #expect(account.balanceMinor == account.chargedMinor - account.paidMinor)
        #expect(account.balanceMinor == seededBalance)
        #expect(!account.hasCredit)
    }

    @Test("Açık kalem listesi kısmi tahsilatı düşer")
    func openChargesReflectAllocations() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let lazer = try #require(store.charges.first { $0.id == MockFinanceSeed.chargeAyseLazer })
        // Kalem 120.000, üzerine 80.000 tahsis edilmiş → kalan 40.000.
        #expect(lazer.totalMinor == 120_000)
        #expect(store.remainingBalance(of: lazer) == 40_000)
    }

    // MARK: Tahsilat ve dağıtım

    @Test("Dağıtım verilmezse açık kalemlere ESKİDEN YENİYE gider")
    func autoAllocationIsOldestFirst() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let payment = try await store.createPayment(
            CreatePaymentInput(
                customerId: MockCustomerSeed.ayse,
                method: .card,
                amountMinor: 50_000
            ),
            idempotencyKey: UUID().uuidString
        )

        // En eski açık kalem lazer (kalan 40.000); artan 10.000 ürün kalemine.
        #expect(payment.allocations.count == 2)
        #expect(payment.allocations[0].chargeId == MockFinanceSeed.chargeAyseLazer)
        #expect(payment.allocations[0].amountMinor == 40_000)
        #expect(payment.allocations[1].chargeId == MockFinanceSeed.chargeAyseUrun)
        #expect(payment.allocations[1].amountMinor == 10_000)
        #expect(payment.unallocatedMinor == 0)
    }

    @Test("Borçtan fazla tahsilatta artan AVANS kalır, hata değil")
    func excessBecomesAdvance() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let payment = try await store.createPayment(
            CreatePaymentInput(
                customerId: MockCustomerSeed.ayse,
                method: .card,
                amountMinor: seededBalance + 25_000
            ),
            idempotencyKey: UUID().uuidString
        )

        #expect(payment.allocatedMinor == seededBalance)
        #expect(payment.unallocatedMinor == 25_000)
        #expect(payment.hasAdvance)
        // Avans bakiyeyi eksiye çekiyor: müşterinin alacağı doğdu.
        let account = try #require(store.account)
        #expect(account.balanceMinor == -25_000)
        #expect(account.hasCredit)
    }

    @Test("Kalem bakiyesini aşan elle tahsis PAYMENT_EXCEEDS_BALANCE verir")
    func manualAllocationCannotExceedCharge() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        await #expect(throws: APIError.self) {
            _ = try await store.createPayment(
                CreatePaymentInput(
                    customerId: MockCustomerSeed.ayse,
                    method: .card,
                    amountMinor: 100_000,
                    // Lazer kaleminde yalnız 40.000 açık kaldı.
                    allocations: [
                        PaymentAllocationInput(
                            chargeId: MockFinanceSeed.chargeAyseLazer,
                            amountMinor: 100_000
                        )
                    ]
                ),
                idempotencyKey: UUID().uuidString
            )
        }

        do {
            _ = try await store.createPayment(
                CreatePaymentInput(
                    customerId: MockCustomerSeed.ayse,
                    method: .card,
                    amountMinor: 100_000,
                    allocations: [
                        PaymentAllocationInput(
                            chargeId: MockFinanceSeed.chargeAyseLazer,
                            amountMinor: 100_000
                        )
                    ]
                ),
                idempotencyKey: UUID().uuidString
            )
            Issue.record("Aşırı tahsis kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .paymentExceedsBalance)
        }

        // Bakiye bozulmadı: reddedilen istek hiçbir şey yazmadı.
        #expect(store.account?.balanceMinor == seededBalance)
    }

    @Test("Aynı idempotency anahtarı ikinci bir tahsilat üretmez")
    func paymentIsIdempotent() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()
        let key = UUID().uuidString

        let first = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 10_000),
            idempotencyKey: key
        )
        let second = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 10_000),
            idempotencyKey: key
        )

        #expect(first.id == second.id)
        #expect(first.receiptNo == second.receiptNo)
        // Bakiye BİR kez düştü — sheet'in anahtarı sabit tutmasının sebebi bu.
        #expect(store.account?.balanceMinor == seededBalance - 10_000)
    }

    @Test("Makbuz numarası boşluksuz artar")
    func receiptNumbersAreGapless() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        var numbers: [Int] = []
        for _ in 0..<3 {
            let payment = try await store.createPayment(
                CreatePaymentInput(
                    customerId: MockCustomerSeed.ayse,
                    method: .card,
                    amountMinor: 1_000
                ),
                idempotencyKey: UUID().uuidString
            )
            numbers.append(payment.receiptNo)
        }

        #expect(numbers == [2, 3, 4])
    }

    @Test("Tahsilat iptali bakiyeyi geri getirir, tahsis satırlarını SİLMEZ")
    func voidRestoresBalanceKeepsAllocations() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let payment = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 40_000),
            idempotencyKey: UUID().uuidString
        )
        #expect(store.account?.balanceMinor == seededBalance - 40_000)

        try await store.voidPayment(
            id: payment.id,
            version: payment.version,
            reason: "Yanlış müşteriye kaydedildi"
        )

        #expect(store.account?.balanceMinor == seededBalance)
        let voided = try #require(store.payments.first { $0.id == payment.id })
        #expect(voided.status == .void)
        // Kritik: satırlar duruyor, yalnız bakiye hesabına girmiyorlar.
        #expect(!voided.allocations.isEmpty)
    }

    @Test("Bayat sürümle iptal VERSION_CONFLICT verir")
    func staleVoidConflicts() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let payment = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 5_000),
            idempotencyKey: UUID().uuidString
        )

        do {
            try await store.voidPayment(id: payment.id, version: payment.version + 5, reason: "Hatalı kayıt")
            Issue.record("Bayat sürüm kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .versionConflict)
        }
    }

    // MARK: Nakit ve kasa

    @Test("Kasa kapalıyken nakit tahsilat CASH_SESSION_REQUIRED verir")
    func cashNeedsOpenSession() async throws {
        let mock = graph()
        let cash = CashSessionStore(service: mock.finance)
        let store = accountStore(mock)
        await store.load()
        await cash.load()

        // Tohumdaki açık kasa kapatılıyor; ardından nakit reddedilmeli.
        let open = try #require(cash.openSession(in: MockGraph.branchId))
        _ = try await cash.close(
            sessionId: open.id,
            version: open.version,
            countedMinor: 130_000,
            differenceReason: nil
        )

        do {
            _ = try await store.createPayment(
                CreatePaymentInput(
                    customerId: MockCustomerSeed.ayse,
                    method: .cash,
                    amountMinor: 10_000
                ),
                idempotencyKey: UUID().uuidString
            )
            Issue.record("Kasasız nakit tahsilat kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .cashSessionRequired)
        }

        // Kart aynı anda çalışmalı: kısıt yönteme özgü, tahsilata değil.
        let card = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 10_000),
            idempotencyKey: UUID().uuidString
        )
        #expect(card.cashSessionId == nil)
    }

    @Test("Oturum verilmezse şubenin açık kasası kendiliğinden bulunur")
    func cashSessionResolvedImplicitly() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let payment = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .cash, amountMinor: 5_000),
            idempotencyKey: UUID().uuidString
        )

        // Sunucudaki `resolveCashSession` ile aynı davranış.
        #expect(payment.cashSessionId == MockFinanceSeed.cashSessionOpen)
    }

    @Test("İkinci kasa açılışı CASH_SESSION_ALREADY_OPEN verir")
    func secondSessionRejected() async throws {
        let mock = graph()
        let cash = CashSessionStore(service: mock.finance)
        await cash.load()

        do {
            _ = try await cash.open(openingBalanceMinor: 0)
            Issue.record("İkinci kasa açıldı")
        } catch let error as APIError {
            #expect(error.code == .cashSessionAlreadyOpen)
        }
    }

    @Test("Beklenen tutar yalnız nakit hareketlerden doğar")
    func expectedCashExcludesCardPayments() async throws {
        let mock = graph()
        let cash = CashSessionStore(service: mock.finance)
        let store = accountStore(mock)
        await store.load()
        await cash.load()
        await cash.loadSummary(sessionId: MockFinanceSeed.cashSessionOpen)

        let before = try #require(cash.summary(for: MockFinanceSeed.cashSessionOpen).value)
        // 50.000 açılış + 80.000 tohum tahsilatı.
        #expect(before.expectedMinor == 130_000)

        _ = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 20_000),
            idempotencyKey: UUID().uuidString
        )
        _ = try await store.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .cash, amountMinor: 15_000),
            idempotencyKey: UUID().uuidString
        )
        await cash.loadSummary(sessionId: MockFinanceSeed.cashSessionOpen)

        let after = try #require(cash.summary(for: MockFinanceSeed.cashSessionOpen).value)
        // Yalnız nakit 15.000 çekmeceye girdi; kart 20.000 girmedi.
        #expect(after.expectedMinor == 145_000)
        // Kart yine de yöntem kırılımında görünüyor.
        #expect(after.byMethod.contains { $0.method == .card && $0.amountMinor == 20_000 })
    }

    @Test("Kapanışta fark hesaplanır ve gerekçesiz fark reddedilir")
    func closingRequiresReasonOnDifference() async throws {
        let mock = graph()
        let cash = CashSessionStore(service: mock.finance)
        await cash.load()
        await cash.loadSummary(sessionId: MockFinanceSeed.cashSessionOpen)

        let summary = try #require(cash.summary(for: MockFinanceSeed.cashSessionOpen).value)
        #expect(summary.difference(counted: 125_000) == -5_000)

        let open = try #require(cash.openSession(in: MockGraph.branchId))
        do {
            _ = try await cash.close(
                sessionId: open.id,
                version: open.version,
                countedMinor: 125_000,
                differenceReason: nil
            )
            Issue.record("Gerekçesiz fark kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .validationFailed)
        }

        let closed = try await cash.close(
            sessionId: open.id,
            version: open.version,
            countedMinor: 125_000,
            differenceReason: "Bozuk para farkı"
        )
        #expect(closed.status == .closed)
        #expect(closed.expectedMinor == 130_000)
        #expect(closed.differenceMinor == -5_000)
        #expect(closed.hasDifference)
    }

    @Test("Nakit iade çekmeceden ÇIKIŞ olarak yazılır")
    func refundLeavesDrawer() async throws {
        let mock = graph()
        let cash = CashSessionStore(service: mock.finance)
        let store = accountStore(mock)
        await store.load()
        await cash.loadSummary(sessionId: MockFinanceSeed.cashSessionOpen)

        _ = try await store.createRefund(
            CreateRefundInput(
                customerId: MockCustomerSeed.ayse,
                kind: .service,
                amountMinor: 10_000,
                method: .cash,
                cashSessionId: MockFinanceSeed.cashSessionOpen,
                reason: "Hizmet yarıda kaldı"
            ),
            idempotencyKey: UUID().uuidString
        )
        await cash.loadSummary(sessionId: MockFinanceSeed.cashSessionOpen)

        let summary = try #require(cash.summary(for: MockFinanceSeed.cashSessionOpen).value)
        #expect(summary.expectedMinor == 120_000)
        #expect(summary.movements.contains { $0.kind == .refund && $0.amountMinor == -10_000 })
    }

    // MARK: Kalem ve indirim

    @Test("Elle kalem KDV'yi fiyatın İÇİNDEN çıkarır")
    func manualChargeSplitsVatInclusive() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let charge = try await store.createCharge(
            CreateChargeInput(
                customerId: MockCustomerSeed.ayse,
                source: "product",
                description: "Bakım şampuanı",
                quantity: 3,
                unitPriceMinor: 33_333,
                vatRateBasisPoints: 2000
            ),
            idempotencyKey: UUID().uuidString
        )

        #expect(charge.totalMinor == 99_999)
        #expect(charge.netMinor + charge.vatMinor == charge.totalMinor)
        // 99999 × 2000 / 12000 = 16666,5 → yarım ÇİFTE gider: 16666.
        #expect(charge.vatMinor == 16_666)
    }

    @Test("Gerekçesiz fiyat override'ı reddedilir")
    func overrideNeedsReason() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        do {
            _ = try await store.createCharge(
                CreateChargeInput(
                    customerId: MockCustomerSeed.ayse,
                    source: "product",
                    description: "İndirimli ürün",
                    unitPriceMinor: 40_000,
                    unitListPriceMinor: 50_000
                ),
                idempotencyKey: UUID().uuidString
            )
            Issue.record("Gerekçesiz override kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .validationFailed)
        }

        let withReason = try await store.createCharge(
            CreateChargeInput(
                customerId: MockCustomerSeed.ayse,
                source: "product",
                description: "İndirimli ürün",
                unitPriceMinor: 40_000,
                unitListPriceMinor: 50_000,
                priceOverrideReason: "Müdür onaylı kampanya"
            ),
            idempotencyKey: UUID().uuidString
        )
        #expect(withReason.isPriceOverridden)
    }

    @Test("Süresi dolmuş indirim DISCOUNT_INVALID verir ve seçicide görünmez")
    func expiredDiscountRejected() async throws {
        let mock = graph()
        let discounts = DiscountStore(service: mock.finance)
        let store = accountStore(mock)
        await store.load()
        await discounts.load()

        // Tohumdaki "İlk seans indirimi" süresi dolmuş: listede var, seçilebilir değil.
        #expect(discounts.discounts.contains { $0.id == MockFinanceSeed.discountIlkSeans })
        #expect(!discounts.selectable().contains { $0.id == MockFinanceSeed.discountIlkSeans })

        do {
            _ = try await store.createCharge(
                CreateChargeInput(
                    customerId: MockCustomerSeed.ayse,
                    source: "manual",
                    description: "Test",
                    unitPriceMinor: 10_000,
                    discountId: MockFinanceSeed.discountIlkSeans
                ),
                idempotencyKey: UUID().uuidString
            )
            Issue.record("Süresi dolmuş indirim kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .discountInvalid)
        }
    }

    @Test("Tahsilat yapılmış kalem iptal edilemez")
    func paidChargeCannotBeVoided() async throws {
        let mock = graph()
        let store = accountStore(mock)
        await store.load()

        let lazer = try #require(store.charges.first { $0.id == MockFinanceSeed.chargeAyseLazer })
        await #expect(throws: APIError.self) {
            try await store.voidCharge(id: lazer.id, version: lazer.version, reason: "Yanlış kalem")
        }

        // Tahsilatı olmayan kalem iptal edilebilmeli.
        let urun = try #require(store.charges.first { $0.id == MockFinanceSeed.chargeAyseUrun })
        try await store.voidCharge(id: urun.id, version: urun.version, reason: "Ürün iade edildi")
        // İptal borcu düşürüyor: 165.000 − 45.000 kalem, 80.000 tahsilat.
        #expect(store.account?.balanceMinor == 120_000 - 80_000)
    }

    // MARK: Prim

    @Test("Kural çakışmasında personel bazlı override kazanır")
    func staffOverrideWinsResolution() async throws {
        let mock = graph()
        let store = CommissionStore(service: mock.commissions)
        await store.loadRules()

        // Liste çözüm sırasına göre: en spesifik kural üstte.
        #expect(store.rules.first?.id == MockFinanceSeed.ruleLazerMehmet)
        #expect(store.rules.first?.staffProfileId == MockStaffSeed.profileMehmet)
        #expect(store.rules.last?.scope == .global)
    }

    @Test("Aynı kapsam ve öncelikte ikinci aktif kural CONFLICT verir")
    func duplicateResolutionKeyRejected() async throws {
        let mock = graph()
        let store = CommissionStore(service: mock.commissions)
        await store.loadRules()

        do {
            _ = try await store.createRule(
                CreateCommissionRuleInput(
                    name: "İkinci genel kural",
                    scope: .global,
                    calcKind: .percent,
                    value: 2000,
                    priority: 0
                )
            )
            Issue.record("Çakışan kural kabul edildi")
        } catch let error as APIError {
            #expect(error.code == .conflict)
        }

        // Farklı öncelikle kabul edilmeli: belirsizlik yalnız EŞİT önceliktedir.
        let created = try await store.createRule(
            CreateCommissionRuleInput(
                name: "Genel kural %20",
                scope: .global,
                calcKind: .percent,
                value: 2000,
                priority: 50
            )
        )
        #expect(created.priority == 50)
    }

    @Test("Kapalı dönem yeniden kapatılamaz")
    func closedPeriodIsFrozen() async throws {
        let mock = graph()
        let store = CommissionStore(service: mock.commissions)
        await store.loadPeriods()

        let period = try #require(store.openPeriods.first)
        let closed = try await store.closePeriod(id: period.id, version: period.version)
        #expect(closed.isClosed)
        #expect(closed.closedAt != nil)

        do {
            _ = try await store.closePeriod(id: closed.id, version: closed.version)
            Issue.record("Kapalı dönem yeniden kapatıldı")
        } catch let error as APIError {
            #expect(error.code == .periodClosed)
        }
    }

    @Test("Rapor toplamı satırlarla tutar ve ters kayıtlar düşülür")
    func reportNetsOutReversals() async throws {
        let mock = graph()
        let store = CommissionStore(service: mock.commissions)
        await store.loadReport()

        let before = try #require(store.report)
        #expect(before.totalMinor == before.rows.reduce(0) { $0 + $1.amountMinor })
        // Tohum: 15.000 + 37.500.
        #expect(before.totalMinor == 52_500)
    }

    @Test("Tahsilat iptali prim tahakkukunu ters kayıtla düşer")
    func voidingPaymentReversesAccrual() async throws {
        let mock = graph()
        let commissions = CommissionStore(service: mock.commissions)
        let account = accountStore(mock)
        await account.load()

        // Tahsilat tetikleyicili bir kural gerekiyor; tohumdakiler
        // `service_completed`. Önce onu kuruyoruz.
        _ = try await commissions.createRule(
            CreateCommissionRuleInput(
                name: "Tahsilat primi %5",
                scope: .global,
                staffProfileId: MockStaffSeed.profileMehmet,
                calcKind: .percent,
                value: 500,
                basis: .collectedAmount,
                triggerOn: .paymentReceived,
                priority: 5
            )
        )

        await commissions.loadReport()
        let before = try #require(commissions.report).totalMinor

        let payment = try await account.createPayment(
            CreatePaymentInput(customerId: MockCustomerSeed.ayse, method: .card, amountMinor: 40_000),
            idempotencyKey: UUID().uuidString
        )
        await commissions.loadReport()
        // 40.000 × %5 = 2.000.
        #expect(try #require(commissions.report).totalMinor == before + 2_000)

        try await account.voidPayment(
            id: payment.id,
            version: payment.version,
            reason: "Yanlış müşteriye kaydedildi"
        )
        await commissions.loadReport()
        await commissions.loadAccruals()

        // Ters kayıt tahakkuku SİFİRLAMAZ, negatifiyle dengeler.
        #expect(try #require(commissions.report).totalMinor == before)
        #expect(commissions.accruals.contains { $0.isReversal && $0.amountMinor == -2_000 })
        #expect(commissions.accruals.contains { !$0.isReversal && $0.amountMinor == 2_000 })
    }

    // MARK: Yüzde ↔ baz puan dönüşümü

    @Test("Kural formu yüzdeyi baz puana çevirir")
    func percentConvertsToBasisPoints() {
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "10") == 1000)
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "12,5") == 1250)
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "12.5") == 1250)
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "%15") == 1500)
        // Ayrıştırılamayan girdi sessizce sıfır olmamalı: kullanıcının
        // yazdığından farklı bir prim kaydetmenin en kestirme yolu bu olurdu.
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "") == nil)
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "abc") == nil)
        #expect(CommissionRuleForm.basisPoints(fromPercentText: "-5") == nil)

        #expect(CommissionRuleForm.percentText(fromBasisPoints: 1000) == "10")
        #expect(CommissionRuleForm.percentText(fromBasisPoints: 1250) == "12,50")
    }

    @Test("Yuvarlama yarıyı ÇİFTE götürür")
    func roundingIsHalfEven() {
        // 2,5 → 2 ve 3,5 → 4: `Math.round` ikisini de yukarı çekip
        // yüzlerce kalem üzerinde sistematik sapma biriktirirdi.
        #expect(MoneyMath.roundHalfEven(numerator: 5, denominator: 2) == 2)
        #expect(MoneyMath.roundHalfEven(numerator: 7, denominator: 2) == 4)
        #expect(MoneyMath.roundHalfEven(numerator: -5, denominator: 2) == -2)
        #expect(MoneyMath.vatIncluded(total: 99_999, rateBasisPoints: 2000) == 16_666)
        #expect(MoneyMath.vatIncluded(total: 50_000, rateBasisPoints: 0) == 0)
    }
}
