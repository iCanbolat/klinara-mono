import Foundation

/// Mock rapor verisi.
///
/// Sayılar TUTARLI seçildi: doluluk oranları dakikalardan, no-show oranları
/// sayılardan gerçekten çıkıyor. Rastgele sayılar koymak, ekranı "makul
/// görünen ama kendi içinde çelişen" bir hâlde bırakır ve bir biçimlendirme
/// hatasını gizlerdi.
enum MockReportsSeed {

    // MARK: Doluluk

    static func occupancyRows(groupBy: OccupancyGrouping, ownOnly: Bool) -> [OccupancyRow] {
        switch groupBy {
        case .day:
            return [
                row(id: nil, label: "2026-09-07", booked: 330, available: 480),
                row(id: nil, label: "2026-09-08", booked: 420, available: 480),
                row(id: nil, label: "2026-09-09", booked: 240, available: 480),
            ]
        case .branch:
            return [row(id: MockIDs.branchNisantasi, label: "Nişantaşı", booked: 990, available: 1440)]
        case .staff:
            let mine = row(id: MockStaffSeed.profileAyse, label: "Ayşe Yılmaz", booked: 540, available: 960)
            if ownOnly { return [mine] }
            return [
                mine,
                row(id: MockStaffSeed.profileMehmet, label: "Mehmet Demir", booked: 450, available: 480),
            ]
        }
    }

    private static func row(id: String?, label: String, booked: Int, available: Int) -> OccupancyRow {
        OccupancyRow(
            groupId: id,
            groupLabel: label,
            bookedMinutes: booked,
            availableMinutes: available,
            occupancyRate: rate(booked, available)
        )
    }

    static func occupancyTotals(for rows: [OccupancyRow]) -> OccupancyTotals {
        let booked = rows.reduce(0) { $0 + $1.bookedMinutes }
        let available = rows.reduce(0) { $0 + $1.availableMinutes }
        return OccupancyTotals(
            bookedMinutes: booked,
            availableMinutes: available,
            occupancyRate: rate(booked, available)
        )
    }

    static let occupancyPrevious = OccupancyTotals(
        bookedMinutes: 780,
        availableMinutes: 1440,
        occupancyRate: 54.17
    )

    /// Yüzde, iki basamak — sunucudaki yuvarlamanın aynısı.
    private static func rate(_ part: Int, _ whole: Int) -> Double {
        guard whole > 0 else { return 0 }
        return (Double(part) / Double(whole) * 10000).rounded() / 100
    }

    // MARK: Ciro

    static let revenueTotals = RevenueTotals(
        accruedMinor: 1_250_000,
        collectedMinor: 980_000,
        refundedMinor: 45_000,
        currency: "TRY"
    )

    static let revenuePrevious = RevenueTotals(
        accruedMinor: 1_100_000,
        collectedMinor: 1_070_000,
        refundedMinor: 0,
        currency: "TRY"
    )

    static func revenueRows(groupBy: RevenueGrouping) -> [RevenueRow] {
        switch groupBy {
        case .method:
            return [
                // Yöntem kırılımında tahakkuk BİLEREK sıfır: ödeme yöntemi bir
                // kalem özelliği değil, tahsilat özelliği.
                RevenueRow(groupId: nil, groupLabel: "card", accruedMinor: 0, collectedMinor: 720_000),
                RevenueRow(groupId: nil, groupLabel: "cash", accruedMinor: 0, collectedMinor: 260_000),
            ]
        case .day:
            return [
                RevenueRow(groupId: nil, groupLabel: "2026-09-07", accruedMinor: 450_000, collectedMinor: 380_000),
                RevenueRow(groupId: nil, groupLabel: "2026-09-08", accruedMinor: 800_000, collectedMinor: 600_000),
            ]
        default:
            return [
                RevenueRow(
                    groupId: MockCatalogSeed.serviceLazerTumVucut,
                    groupLabel: "Tüm Vücut Lazer",
                    accruedMinor: 900_000,
                    collectedMinor: 700_000
                ),
                RevenueRow(
                    groupId: MockCatalogSeed.serviceLazerBolgesel,
                    groupLabel: "Bölgesel Lazer",
                    accruedMinor: 350_000,
                    collectedMinor: 280_000
                ),
            ]
        }
    }

    // MARK: Personel performansı

    static func staffRows(ownOnly: Bool) -> [StaffPerformanceRow] {
        let mine = StaffPerformanceRow(
            staffProfileId: MockStaffSeed.profileAyse,
            staffName: "Ayşe Yılmaz",
            completedServices: 42,
            revenueMinor: 780_000,
            commissionMinor: 78_000,
            bookedMinutes: 540,
            availableMinutes: 960,
            occupancyRate: 56.25
        )
        if ownOnly { return [mine] }
        return [
            mine,
            StaffPerformanceRow(
                staffProfileId: MockStaffSeed.profileMehmet,
                staffName: "Mehmet Demir",
                completedServices: 27,
                revenueMinor: 470_000,
                commissionMinor: 47_000,
                bookedMinutes: 450,
                availableMinutes: 480,
                occupancyRate: 93.75
            ),
        ]
    }

    // MARK: Gelmeme

    static let noShowTotals = NoShowTotals(
        total: 120,
        completed: 96,
        noShow: 14,
        cancelled: 10,
        noShowRate: 11.67,
        cancellationRate: 8.33
    )

    static let noShowPrevious = NoShowTotals(
        total: 104,
        completed: 88,
        noShow: 9,
        cancelled: 7,
        noShowRate: 8.65,
        cancellationRate: 6.73
    )

    static let noShowRows = [
        NoShowRow(
            groupId: MockStaffSeed.profileAyse,
            groupLabel: "Ayşe Yılmaz",
            total: 70,
            completed: 58,
            noShow: 8,
            cancelled: 4,
            noShowRate: 11.43,
            cancellationRate: 5.71
        ),
        NoShowRow(
            groupId: MockStaffSeed.profileMehmet,
            groupLabel: "Mehmet Demir",
            total: 50,
            completed: 38,
            noShow: 6,
            cancelled: 6,
            noShowRate: 12.0,
            cancellationRate: 12.0
        ),
    ]

    /// Online randevunun gelmeme oranı İÇ randevudan yüksek — bölüm 11'in
    /// 8. ürün sorusunun (kapora almadan no-show'u ne sınırlar) beklediği
    /// tablo bu.
    static let noShowByOrigin = [
        NoShowByOrigin(
            origin: "internal",
            total: 92,
            completed: 78,
            noShow: 8,
            cancelled: 6,
            noShowRate: 8.7,
            cancellationRate: 6.52
        ),
        NoShowByOrigin(
            origin: "online",
            total: 28,
            completed: 18,
            noShow: 6,
            cancelled: 4,
            noShowRate: 21.43,
            cancellationRate: 14.29
        ),
    ]

    // MARK: Kazanım

    static let retentionTotals = RetentionTotals(
        newCustomers: 18,
        returningCustomers: 47,
        activeCustomers: 65,
        returningRate: 72.31
    )

    static let retentionPrevious = RetentionTotals(
        newCustomers: 14,
        returningCustomers: 41,
        activeCustomers: 55,
        returningRate: 74.55
    )

    static let acquisition = [
        AcquisitionRow(source: "instagram", customers: 24),
        AcquisitionRow(source: "referral", customers: 19),
        // Kaynağı girilmemiş müşteri her klinikte var; ekranın onu
        // "Belirtilmemiş" diye göstermesi burada sınanıyor.
        AcquisitionRow(source: nil, customers: 22),
    ]

    static let cohorts = [
        CohortReturn(withinDays: 30, returned: 7, rate: 38.89),
        CohortReturn(withinDays: 60, returned: 11, rate: 61.11),
        CohortReturn(withinDays: 90, returned: 12, rate: 66.67),
    ]
}
