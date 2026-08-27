import Foundation

/// Uygulamanın bağımlılık kökü.
///
/// "Mock mu canlı mı" sorusu **yalnız burada** cevaplanır; ekranlar ve akış
/// modelleri protokollere konuşur ve hangi uygulamanın arkada durduğunu bilmez.
@MainActor
final class ServiceContainer {

    let auth: any AuthService
    let catalog: any CatalogService
    let staff: any StaffService
    let scheduling: any SchedulingService
    let users: any UsersService
    let booking: any BookingService
    let customers: any CustomerService
    let notes: any NotesService
    let files: any FilesService

    /// Mock kullanılıyorsa geliştirici senaryo menüsü açılır.
    let mockAuth: MockAuthService?
    /// Mock veride hangi senaryonun yüklü olduğu — menüde seçili satır için.
    private(set) var mockDataScenario: MockDataScenario?

    private init(
        auth: any AuthService,
        catalog: any CatalogService,
        staff: any StaffService,
        scheduling: any SchedulingService,
        users: any UsersService,
        booking: any BookingService,
        customers: any CustomerService,
        notes: any NotesService,
        files: any FilesService,
        mockAuth: MockAuthService?,
        mockDataScenario: MockDataScenario? = nil
    ) {
        self.auth = auth
        self.catalog = catalog
        self.staff = staff
        self.scheduling = scheduling
        self.users = users
        self.booking = booking
        self.customers = customers
        self.notes = notes
        self.files = files
        self.mockAuth = mockAuth
        self.mockDataScenario = mockDataScenario
    }

    /// Gerçek sunucuya bağlanan kurulum.
    static func live() -> ServiceContainer {
        let client = APIClient()
        return ServiceContainer(
            auth: LiveAuthService(client: client),
            catalog: LiveCatalogService(client: client),
            staff: LiveStaffService(client: client),
            scheduling: LiveSchedulingService(client: client),
            users: LiveUsersService(client: client),
            booking: LiveBookingService(client: client),
            customers: LiveCustomerService(client: client),
            notes: LiveNotesService(client: client),
            files: LiveFilesService(client: client),
            mockAuth: nil
        )
    }

    /// Sunucu olmadan arayüzü sürmek için — Preview'lar ve senaryo menüsü.
    ///
    /// İki senaryo bağımsızdır: `scenario` girişin hangi yoldan gideceğini,
    /// `data` oturum açıldıktan sonra görülecek takvimi seçer.
    ///
    /// Mock'lar birbirine **kurucu üzerinden** bağlanır (personel katalogdan,
    /// randevu üçünden birden okur); ayrı ayrı tohumlanmış kopyalar birbirini
    /// tanımayan kimliklerle çalışırdı.
    static func mock(
        scenario: MockScenario = .passwordThenTotp,
        data: MockDataScenario = .busyDay
    ) -> ServiceContainer {
        let mockAuth = MockAuthService(scenario: scenario)
        let catalog = MockCatalogService()
        let staff = MockStaffService(catalog: catalog)
        let scheduling = MockSchedulingService()
        let customers = MockCustomerService(scenario: data)
        let booking = MockBookingService(
            catalog: catalog,
            staff: staff,
            scheduling: scheduling,
            customers: customers,
            scenario: data
        )
        return ServiceContainer(
            auth: mockAuth,
            catalog: catalog,
            staff: staff,
            scheduling: scheduling,
            users: MockUsersService(),
            booking: booking,
            customers: customers,
            notes: MockNotesService(booking: booking),
            files: MockFilesService(),
            mockAuth: mockAuth,
            mockDataScenario: data
        )
    }

    /// Mock veri senaryosunu değiştirir. Canlı kurulumda hiçbir şey yapmaz.
    ///
    /// Konteyneri yeniden kurmak yerine servisleri yeniden tohumluyoruz:
    /// çalışan ``AppSession`` eski servis örneklerini tutuyor ve yeni bir
    /// konteyner ona hiç ulaşmazdı. Çağıran yine de oturumu düşürmeli —
    /// store'lar yüklenmiş veriyi önbelleğinde tutuyor.
    func applyMockData(_ scenario: MockDataScenario) {
        guard let customers = customers as? MockCustomerService,
              let booking = booking as? MockBookingService
        else { return }
        customers.reseed(scenario)
        booking.reseed(scenario)
        (notes as? MockNotesService)?.reseed(canReadMedical: true)
        (files as? MockFilesService)?.reseed(canReadMedical: true)
        mockDataScenario = scenario
    }

    /// Oturum düştüğünde kabuğun haberdar olması için `APIClient`'a bağlanır.
    func onSessionExpired(_ handler: @escaping @Sendable () -> Void) async {
        guard let live = (auth as? LiveAuthService)?.client else { return }
        await live.setSessionExpiredHandler(handler)
    }
}
