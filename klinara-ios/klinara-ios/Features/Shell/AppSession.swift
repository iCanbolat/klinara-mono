import SwiftUI

/// Oturum kapsamlı tek gerçek kaynak.
///
/// `AuthFlowModel` girişin **nasıl** yapıldığını bilir; oturum açıldıktan
/// sonra ekranların ihtiyacı olan şey ise farklıdır: kim olduğum, ne
/// yapabildiğim ve hangi şubede çalıştığım. İkisini tek modelde toplamak,
/// giriş akışının durumunu (challenge token, geri adımı, MFA) uygulamanın
/// geri kalanına sızdırırdı.
@MainActor
@Observable
final class AppSession {

    let services: ServiceContainer

    private(set) var profile: MeResponse
    private(set) var branches: [BranchSummary]
    private(set) var selectedBranchId: String?

    /// Şube değişince tazelenmesi gereken ekranlar için sayaç. `.task(id:)`
    /// bağlanınca şube değiştirmek veriyi otomatik yeniden çeker.
    private(set) var branchGeneration = 0

    /// Katalog ve personel verisi ekran başına değil **oturum başına** yaşar:
    /// personel yetkinlik matrisi hizmet listesine, hizmet formu şube listesine
    /// bakar. Ekran başına çekmek hem fazladan istek hem de ekranlar arası
    /// tutarsızlık üretirdi.
    let catalogStore: CatalogStore
    let staffStore: StaffStore
    /// Takvim ve müşteriler de oturum ömürlü: randevu oluşturma sayfası,
    /// randevu detayı ve müşteri kartı **aynı** listeyi güncelliyor.
    let calendarStore: CalendarStore
    let customerStore: CustomerStore

    private let tokens: TokenStore

    init(
        profile: MeResponse,
        branches: [BranchSummary],
        services: ServiceContainer,
        tokens: TokenStore? = nil
    ) {
        self.profile = profile
        self.branches = branches
        self.services = services
        let catalogStore = CatalogStore(service: services.catalog)
        self.catalogStore = catalogStore
        self.staffStore = StaffStore(service: services.staff)
        self.calendarStore = CalendarStore(service: services.booking, catalog: catalogStore)
        self.customerStore = CustomerStore(service: services.customers)
        let store = tokens ?? .shared
        self.tokens = store
        self.selectedBranchId = store.branchId ?? branches.first?.id
    }

    // MARK: Yetki

    /// İzinler token'da taşınmaz, `/me` yanıtından gelir (bkz. API dokümanı 5.2).
    /// `profile`'dan TÜRETİLİR, kopyalanmaz: ``reloadProfile`` sonrası eski bir
    /// izin kümesiyle kalmak, rol geri alınmış bir kullanıcıya hâlâ yönetim
    /// ekranını göstermek demekti.
    private var permissions: Set<String> { Set(profile.permissions) }

    /// Yetki kontrolü **daima izin üzerinden** yapılır, rol adına göre değil —
    /// sunucudaki kuralın aynısı. Yeni bir rol eklendiğinde arayüzde tek satır
    /// değişmemesinin sebebi budur.
    func can(_ permission: String) -> Bool { permissions.contains(permission) }

    func canAny(_ candidates: String...) -> Bool { candidates.contains(where: can) }

    var user: UserProfile { profile.user }

    var roleNames: String {
        profile.roles.map(RoleName.turkish).joined(separator: ", ")
    }

    // MARK: Şube

    var selectedBranch: BranchSummary? {
        branches.first { $0.id == selectedBranchId }
    }

    /// Şube kapsamlı ekranlar için saat dilimi. Şube seçili değilse Türkiye
    /// saatine düşer — cihaz saatine **değil** (bkz. ``BranchClock``).
    var clock: BranchClock { BranchClock(branch: selectedBranch) }

    var canSwitchBranch: Bool { branches.count > 1 }

    func switchBranch(to branch: BranchSummary) {
        guard branch.id != selectedBranchId else { return }
        selectedBranchId = branch.id
        // `X-Branch-Id` başlığının kaynağı burası; token deposuna yazılmadan
        // yapılan bir istek hâlâ eski şubeye gider.
        tokens.setBranch(branch.id)
        branchGeneration += 1
    }

    // MARK: Profil tazeleme

    /// Telefon doğrulama, rol değişikliği gibi durumlardan sonra.
    func reloadProfile() async {
        guard let refreshed = try? await services.auth.me() else { return }
        profile = refreshed
    }
}

// MARK: - Ortam anahtarı

extension EnvironmentValues {
    /// Ekranlar oturumu parametre zinciriyle taşımak yerine ortamdan alır.
    @Entry var appSession: AppSession?
}
