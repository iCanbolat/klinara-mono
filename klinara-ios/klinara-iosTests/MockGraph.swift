import Foundation
@testable import klinara_ios

/// Mock servis grafiğini test için tek yerden kurar.
///
/// Servisler birbirine kurucu üzerinden bağlı (personel katalogdan, randevu
/// üçünden birden okur); her testin bu zinciri yeniden kurması, bir gün
/// birinin bağlantıyı atlaması demekti.
struct MockGraph {

    let catalog: MockCatalogService
    let staff: MockStaffService
    let scheduling: MockSchedulingService
    let customers: MockCustomerService
    let booking: MockBookingService
    let notes: MockNotesService
    let files: MockFilesService
    let packages: MockPackagesService
    let finance: MockFinanceService
    let commissions: MockCommissionsService
    let clock: BranchClock

    /// Nişantaşı şubesi: mock çalışma saatlerinin ve personel şablonunun
    /// kurulu olduğu tek şube.
    static let branchId = MockIDs.branchNisantasi

    init(
        scenario: MockDataScenario = .emptyDay,
        canReopen: Bool = true,
        canReadMedical: Bool = true
    ) {
        catalog = MockCatalogService()
        staff = MockStaffService(catalog: catalog)
        scheduling = MockSchedulingService()
        customers = MockCustomerService(scenario: scenario)
        booking = MockBookingService(
            catalog: catalog,
            staff: staff,
            scheduling: scheduling,
            customers: customers,
            scenario: scenario,
            canReopen: canReopen
        )
        packages = MockPackagesService(catalog: catalog, customers: customers, booking: booking)
        finance = MockFinanceService(customers: customers)
        commissions = MockCommissionsService()
        // Tahsilat prim tahakkuku doğursun diye iki mock bağlanıyor —
        // ``ServiceContainer/mock(scenario:data:)`` ile birebir aynı bağ.
        finance.commissions = commissions
        notes = MockNotesService(booking: booking, canReadMedical: canReadMedical)
        files = MockFilesService(canReadMedical: canReadMedical)
        clock = BranchClock(timeZoneIdentifier: MockBookingSeed.timezone)
    }

    /// Personel şablonu Pzt/Sal/Per/Cum/Cmt 10:00–18:00, çarşamba ve pazar
    /// izinli. Testler sabit bir salı gününe yazıyor ki sonuç takvime bağlı
    /// olmasın — "bugün" çarşambaysa geçen, perşembeyse kalan test istemiyoruz.
    func workingTuesday(hour: Int = 11, minute: Int = 0) -> Date {
        // 2026-09-08 bir salı.
        let day = clock.date(fromLocalDateString: "2026-09-08") ?? Date()
        return clock.date(on: day, at: ClockTime(hour: hour, minute: minute))
    }

    func createInput(
        at start: Date,
        serviceIds: [String] = [MockCatalogSeed.serviceLazerBolgesel],
        staffProfileId: String = MockStaffSeed.profileAyse,
        customerId: String = MockCustomerSeed.ayse,
        notes: String? = nil
    ) -> CreateAppointmentInput {
        CreateAppointmentInput(
            branchId: Self.branchId,
            customerId: customerId,
            startsAt: clock.wireValue(start),
            services: serviceIds.map {
                AppointmentServiceInput(serviceId: $0, staffProfileId: staffProfileId)
            },
            notes: notes
        )
    }
}

extension APIError {
    /// Testlerde kod eşlemesini tek satıra indirir.
    var code: APIErrorCode? {
        guard case .problem(let problem) = self else { return nil }
        return problem.code
    }

    var status: Int? {
        guard case .problem(let problem) = self else { return nil }
        return problem.status
    }
}
