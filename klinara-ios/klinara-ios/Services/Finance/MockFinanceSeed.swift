import Foundation

/// Mock finans verisinin başlangıç durumu.
///
/// Tohum kasıtlı olarak **yarım kalmış bir gün**i temsil eder: bir müşterinin
/// açık borcu ve kısmi tahsilatı var, kasa açık ve içinde hareket var. Sıfırdan
/// başlayan bir tohum, cari hesap ekranını ve kasa özetini boş gösterir; ekranın
/// asıl zor durumu (kısmi dağıtım, avans, fark) hiç görünmezdi.
enum MockFinanceSeed {

    static let chargeAyseLazer = "d1000000-0000-4000-8000-000000000001"
    static let chargeAyseUrun = "d1000000-0000-4000-8000-000000000002"
    static let chargeMehmetBotoks = "d1000000-0000-4000-8000-000000000003"

    static let paymentAyseKismi = "d2000000-0000-4000-8000-000000000001"
    static let cashSessionOpen = "d3000000-0000-4000-8000-000000000001"

    static let discountYaz = "d4000000-0000-4000-8000-000000000001"
    static let discountIlkSeans = "d4000000-0000-4000-8000-000000000002"

    static let ruleGlobal = "d5000000-0000-4000-8000-000000000001"
    static let ruleLazerMehmet = "d5000000-0000-4000-8000-000000000002"
    static let periodCurrent = "d6000000-0000-4000-8000-000000000001"

    /// Başlangıç makbuz numarası — tohumdaki tahsilat 1'i kullandı.
    static let firstReceiptNo = 1

    // MARK: Kalemler

    static func charges(at now: Date) -> [Charge] {
        [
            // Randevu kaynaklı: KDV **dahil** 120.000, %20 → net 100.000, KDV 20.000.
            charge(
                id: chargeAyseLazer,
                customerId: MockCustomerSeed.ayse,
                source: .appointmentService,
                description: "Bölgesel Lazer Epilasyon",
                unitPriceMinor: 120_000,
                createdAt: now.addingTimeInterval(-3 * 86_400)
            ),
            charge(
                id: chargeAyseUrun,
                customerId: MockCustomerSeed.ayse,
                source: .product,
                description: "Bakım şampuanı 250 ml",
                unitPriceMinor: 45_000,
                createdAt: now.addingTimeInterval(-2 * 86_400)
            ),
            charge(
                id: chargeMehmetBotoks,
                customerId: MockCustomerSeed.mehmet,
                source: .appointmentService,
                description: "Botoks Uygulaması",
                unitPriceMinor: 450_000,
                createdAt: now.addingTimeInterval(-86_400)
            ),
        ]
    }

    /// KDV **fiyata dahil**: `vat = round(total × rate / (10000 + rate))`,
    /// `net = total - vat`. Sunucudaki `splitVatInclusive` ile aynı formül;
    /// mock'un başka bir yuvarlama kullanması ekranda tutmayan bir toplam demekti.
    static func charge(
        id: String,
        customerId: String,
        source: ChargeSource,
        description: String,
        quantity: Int = 1,
        unitPriceMinor: Int,
        unitListPriceMinor: Int? = nil,
        discountMinor: Int = 0,
        vatRateBasisPoints: Int = 2000,
        status: ChargeStatus = .open,
        branchId: String = MockIDs.branchNisantasi,
        createdAt: Date
    ) -> Charge {
        let total = unitPriceMinor * quantity - discountMinor
        let vat = MoneyMath.vatIncluded(total: total, rateBasisPoints: vatRateBasisPoints)
        return Charge(
            id: id,
            branchId: branchId,
            customerId: customerId,
            source: source,
            appointmentServiceId: nil,
            customerPackageId: nil,
            description: description,
            quantity: quantity,
            unitListPriceMinor: unitListPriceMinor ?? unitPriceMinor,
            unitPriceMinor: unitPriceMinor,
            discountId: nil,
            discountKind: nil,
            discountValue: nil,
            discountMinor: discountMinor,
            vatRateBasisPoints: vatRateBasisPoints,
            totalMinor: total,
            netMinor: total - vat,
            vatMinor: vat,
            currency: "TRY",
            status: status,
            priceOverrideReason: nil,
            voidedAt: nil,
            voidedReason: nil,
            version: 1,
            createdAt: createdAt
        )
    }

    // MARK: Tahsilat

    /// Ayşe'nin 165.000 borcuna karşılık **kısmi** 80.000 tahsilat: eskiden
    /// yeniye dağıtım kuralı gereği tamamı lazer kalemine düşer.
    static func payments(at now: Date) -> [Payment] {
        [
            Payment(
                id: paymentAyseKismi,
                branchId: MockIDs.branchNisantasi,
                customerId: MockCustomerSeed.ayse,
                method: .cash,
                amountMinor: 80_000,
                allocatedMinor: 80_000,
                unallocatedMinor: 0,
                currency: "TRY",
                receiptNo: firstReceiptNo,
                paidAt: now.addingTimeInterval(-2 * 3600),
                cashSessionId: cashSessionOpen,
                note: nil,
                status: .posted,
                voidedAt: nil,
                voidedReason: nil,
                allocations: [
                    PaymentAllocation(
                        id: "d2100000-0000-4000-8000-000000000001",
                        chargeId: chargeAyseLazer,
                        amountMinor: 80_000,
                        chargeDescription: "Bölgesel Lazer Epilasyon"
                    ),
                ],
                version: 1,
                createdAt: now.addingTimeInterval(-2 * 3600)
            ),
        ]
    }

    // MARK: Kasa

    static func cashSessions(at now: Date) -> [CashSession] {
        [
            CashSession(
                id: cashSessionOpen,
                branchId: MockIDs.branchNisantasi,
                status: .open,
                openingBalanceMinor: 50_000,
                openedAt: now.addingTimeInterval(-6 * 3600),
                closedAt: nil,
                expectedMinor: nil,
                countedMinor: nil,
                differenceMinor: nil,
                differenceReason: nil,
                currency: "TRY",
                version: 1
            ),
        ]
    }

    static func cashMovements(at now: Date) -> [String: [CashMovement]] {
        [
            cashSessionOpen: [
                CashMovement(
                    id: "d3100000-0000-4000-8000-000000000001",
                    kind: .opening,
                    amountMinor: 50_000,
                    paymentId: nil,
                    refundId: nil,
                    note: "Açılış bakiyesi",
                    createdAt: now.addingTimeInterval(-6 * 3600)
                ),
                CashMovement(
                    id: "d3100000-0000-4000-8000-000000000002",
                    kind: .payment,
                    amountMinor: 80_000,
                    paymentId: paymentAyseKismi,
                    refundId: nil,
                    note: nil,
                    createdAt: now.addingTimeInterval(-2 * 3600)
                ),
            ],
        ]
    }

    // MARK: İndirimler

    static func discounts(at now: Date) -> [Discount] {
        [
            Discount(
                id: discountYaz,
                code: "YAZ2026",
                name: "Yaz kampanyası",
                kind: .percent,
                value: 1500,
                scope: .all,
                scopeRefId: nil,
                startsAt: now.addingTimeInterval(-30 * 86_400),
                endsAt: now.addingTimeInterval(30 * 86_400),
                maxRedemptions: 100,
                redeemedCount: 12,
                isActive: true,
                version: 1,
                createdAt: now.addingTimeInterval(-30 * 86_400)
            ),
            // Süresi dolmuş bir indirim kasıtlı: seçicinin süzgeci ve
            // `DISCOUNT_INVALID` yolu ancak böyle bir kayıtla sınanabilir.
            Discount(
                id: discountIlkSeans,
                code: nil,
                name: "İlk seans indirimi",
                kind: .amount,
                value: 20_000,
                scope: .service,
                scopeRefId: MockCatalogSeed.serviceLazerBolgesel,
                startsAt: now.addingTimeInterval(-90 * 86_400),
                endsAt: now.addingTimeInterval(-10 * 86_400),
                maxRedemptions: nil,
                redeemedCount: 40,
                isActive: true,
                version: 1,
                createdAt: now.addingTimeInterval(-90 * 86_400)
            ),
        ]
    }

    // MARK: Prim

    static func rules() -> [CommissionRule] {
        [
            CommissionRule(
                id: ruleGlobal,
                name: "Genel prim %10",
                scope: .global,
                scopeRefId: nil,
                staffProfileId: nil,
                calcKind: .percent,
                value: 1000,
                basis: .netAfterDiscount,
                triggerOn: .serviceCompleted,
                priority: 0,
                effectiveFrom: "2026-01-01",
                effectiveTo: nil,
                isActive: true,
                version: 1
            ),
            // Personel bazlı override: çözüm sırasının en üstü. İki kuralın
            // birlikte durması "hangi kural uygulandı" sorusunu ekranda sınanır kılar.
            CommissionRule(
                id: ruleLazerMehmet,
                name: "Mehmet — lazer %15",
                scope: .service,
                scopeRefId: MockCatalogSeed.serviceLazerBolgesel,
                staffProfileId: MockStaffSeed.profileMehmet,
                calcKind: .percent,
                value: 1500,
                basis: .netAfterDiscount,
                triggerOn: .serviceCompleted,
                priority: 10,
                effectiveFrom: "2026-01-01",
                effectiveTo: nil,
                isActive: true,
                version: 1
            ),
        ]
    }

    static func periods(at now: Date) -> [CommissionPeriod] {
        let calendar = Calendar(identifier: .gregorian)
        let components = calendar.dateComponents([.year, .month], from: now)
        let year = components.year ?? 2026
        let month = components.month ?? 1
        let lastDay = calendar.range(of: .day, in: .month, for: now)?.count ?? 30
        return [
            CommissionPeriod(
                id: periodCurrent,
                branchId: MockIDs.branchNisantasi,
                startsOn: String(format: "%04d-%02d-01", year, month),
                endsOn: String(format: "%04d-%02d-%02d", year, month, lastDay),
                status: .open,
                closedAt: nil,
                version: 1
            ),
        ]
    }

    static func accruals(at now: Date) -> [CommissionAccrual] {
        [
            CommissionAccrual(
                id: "d7000000-0000-4000-8000-000000000001",
                staffProfileId: MockStaffSeed.profileMehmet,
                periodId: periodCurrent,
                triggerOn: .serviceCompleted,
                ruleBasis: .netAfterDiscount,
                basisMinor: 100_000,
                amountMinor: 15_000,
                chargeId: chargeAyseLazer,
                paymentId: nil,
                reversesAccrualId: nil,
                reason: nil,
                createdAt: now.addingTimeInterval(-3 * 86_400)
            ),
            CommissionAccrual(
                id: "d7000000-0000-4000-8000-000000000002",
                staffProfileId: MockStaffSeed.profileAyse,
                periodId: periodCurrent,
                triggerOn: .serviceCompleted,
                ruleBasis: .netAfterDiscount,
                basisMinor: 375_000,
                amountMinor: 37_500,
                chargeId: chargeMehmetBotoks,
                paymentId: nil,
                reversesAccrualId: nil,
                reason: nil,
                createdAt: now.addingTimeInterval(-86_400)
            ),
        ]
    }

    static func staffName(for profileId: String) -> String {
        switch profileId {
        case MockStaffSeed.profileAyse: "Ayşe Yılmaz"
        case MockStaffSeed.profileMehmet: "Mehmet Demir"
        default: "Personel"
        }
    }
}

/// Sunucudaki `common/money.ts` yardımcılarının mock karşılığı.
///
/// **Yuvarlama yarıyı çifte** (`roundHalfEven`): `Math.round` her yarımı yukarı
/// çeker ve yüzlerce kalem üzerinde sistematik sapma biriktirir. Sunucu bu
/// kararı verdi; mock'un `Int` bölmesiyle idare etmesi, ekranda sunucununkinden
/// bir kuruş farklı bir KDV göstermek demekti.
enum MoneyMath {

    /// KDV **fiyata dahil**: paydası `10000 + rate`.
    static func vatIncluded(total: Int, rateBasisPoints: Int) -> Int {
        guard rateBasisPoints > 0 else { return 0 }
        return roundHalfEven(numerator: total * rateBasisPoints, denominator: 10_000 + rateBasisPoints)
    }

    /// Yüzde indirimi — baz puan üzerinden.
    static func percentOf(_ amount: Int, basisPoints: Int) -> Int {
        roundHalfEven(numerator: amount * basisPoints, denominator: 10_000)
    }

    /// Yarıyı çifte yuvarlayan tamsayı bölmesi. Negatif pay da doğru çalışır:
    /// iade kalemleri negatif tutar taşıyor.
    static func roundHalfEven(numerator: Int, denominator: Int) -> Int {
        guard denominator != 0 else { return 0 }
        let sign = (numerator < 0) != (denominator < 0) ? -1 : 1
        let absNumerator = abs(numerator)
        let absDenominator = abs(denominator)
        let quotient = absNumerator / absDenominator
        let remainder = absNumerator % absDenominator
        let twice = remainder * 2
        let rounded: Int
        if twice > absDenominator {
            rounded = quotient + 1
        } else if twice < absDenominator {
            rounded = quotient
        } else {
            rounded = quotient.isMultiple(of: 2) ? quotient : quotient + 1
        }
        return sign * rounded
    }
}
