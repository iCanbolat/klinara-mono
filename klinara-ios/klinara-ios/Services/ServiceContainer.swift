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

    /// Mock kullanılıyorsa geliştirici senaryo menüsü açılır.
    let mockAuth: MockAuthService?

    private init(
        auth: any AuthService,
        catalog: any CatalogService,
        staff: any StaffService,
        scheduling: any SchedulingService,
        users: any UsersService,
        mockAuth: MockAuthService?
    ) {
        self.auth = auth
        self.catalog = catalog
        self.staff = staff
        self.scheduling = scheduling
        self.users = users
        self.mockAuth = mockAuth
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
            mockAuth: nil
        )
    }

    /// Sunucu olmadan arayüzü sürmek için — Preview'lar ve senaryo menüsü.
    static func mock(scenario: MockScenario = .passwordThenTotp) -> ServiceContainer {
        let mockAuth = MockAuthService(scenario: scenario)
        let catalog = MockCatalogService()
        return ServiceContainer(
            auth: mockAuth,
            catalog: catalog,
            staff: MockStaffService(catalog: catalog),
            scheduling: MockSchedulingService(),
            users: MockUsersService(),
            mockAuth: mockAuth
        )
    }

    /// Oturum düştüğünde kabuğun haberdar olması için `APIClient`'a bağlanır.
    func onSessionExpired(_ handler: @escaping @Sendable () -> Void) async {
        guard let live = (auth as? LiveAuthService)?.client else { return }
        await live.setSessionExpiredHandler(handler)
    }
}
