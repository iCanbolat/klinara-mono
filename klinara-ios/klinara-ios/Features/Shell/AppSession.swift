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
    /// Paket tanımları da oturum ömürlü: yönetimdeki tanım ekranı ile müşteri
    /// kartındaki satış sayfası **aynı** listeye bakıyor.
    let packageDefinitionStore: PackageDefinitionStore

    private let tokens: TokenStore

    // MARK: Anlık tazeleme

    /// Takvimin yeniden okunması gerektiğinde artar — `.task(id:)` anahtarı.
    ///
    /// Soket "şu şubenin şu günleri değişti" der; sayaç yalnız ekranda açık
    /// olan şube ve günler etkilendiyse artar. Kişinin kendi işlemi de bir
    /// sinyal üretir; o durumda yeniden okuma zararsız bir tekrar.
    private(set) var calendarSignal = 0

    /// Bildirimden açılacak randevu — takvim sekmesi bunu sayfa olarak açar.
    var linkedAppointment: AppointmentLink?

    @ObservationIgnored private let realtime: RealtimeConnection?

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
        self.packageDefinitionStore = PackageDefinitionStore(service: services.packages)
        let store = tokens ?? .shared
        self.tokens = store
        self.selectedBranchId = store.branchId ?? branches.first?.id
        self.realtime = services.realtime.map(RealtimeConnection.init(service:))
        realtime?.onEvent = { [weak self] event in self?.handle(event) }
    }

    /// Uygulama öne geldi ya da oturum açıldı.
    ///
    /// Öne dönüşte takvim de bir kez tazelenir: arka plandayken soket kapalıydı
    /// ve o arada olan biten bilinmiyor. Açılışta tazeleme gereksiz — ekran
    /// zaten ilk yüklemesini yapıyor.
    func becameActive(refresh: Bool) {
        let wasRunning = realtime?.isRunning ?? false
        realtime?.start()
        if refresh, !wasRunning { calendarSignal += 1 }
    }

    /// Arka plana geçerken ve çıkışta. Arka planda soket tutmak pil yer ve
    /// iOS onu zaten askıya alıyor.
    func resignedActive() {
        realtime?.stop()
    }

    private func handle(_ event: RealtimeEvent) {
        switch event {
        case .calendarChanged(let branchId, let days):
            guard branchId == selectedBranchId,
                  calendarStore.covers(days: days, clock: clock)
            else { return }
            calendarSignal += 1
        case .resync:
            calendarSignal += 1
        case .staffNotification:
            // Mobilde zil akışı yok; personel bildirimi push ile geliyor.
            break
        }
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

    /// Uygulayıcı kapsamı: tüm takvimi değil yalnız KENDİ randevularını görür.
    /// Sunucu bu ayrımı izinden yapıyor; arayüz de aynı izinden çıkarıyor.
    var isOwnScope: Bool {
        !can(Permissions.appointmentReadAll) && can(Permissions.appointmentReadOwn)
    }

    /// Kullanıcının kendi personel profili — ``StaffStore`` yüklüyse.
    var ownStaffProfile: StaffProfile? {
        staffStore.profiles.first { $0.userId == user.id }
    }

    /// Kiracı geneli rol (işletme sahibi) — tüm şubeleri kapsar.
    var tenantWide: Bool { profile.tenantWide }

    /// Kullanıcının erişebildiği şube mi — sunucudaki `canAccessBranch` ile aynı.
    func canAccessBranch(_ id: String) -> Bool {
        profile.canAccessBranch(id)
    }

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

    /// Şube menüsünün seçenekleri: pasif şubeler menüde görünmez (orada yeni
    /// iş yapılamaz), yalnız hâlâ seçiliyse — seçim kaybolmasın diye.
    var switchableBranches: [BranchSummary] {
        branches.filter { $0.isActive || $0.id == selectedBranchId }
    }

    var canSwitchBranch: Bool { switchableBranches.count > 1 }

    func switchBranch(to branch: BranchSummary) {
        guard branch.id != selectedBranchId else { return }
        selectedBranchId = branch.id
        // `X-Branch-Id` başlığının kaynağı burası; token deposuna yazılmadan
        // yapılan bir istek hâlâ eski şubeye gider.
        tokens.setBranch(branch.id)
        branchGeneration += 1
    }

    /// Şube eklendikten ya da düzenlendikten sonra. Seçili şube pasife
    /// alındıysa ilk aktif şubeye geçilir: pasif şubede yeni iş yapılamaz ve
    /// şube menüsü onu artık göstermiyor.
    func reloadBranches() async {
        guard let fresh = try? await services.branches.branches() else { return }
        // Login'deki kural: üye olunmayan şube menüde görünmez (aksi hâlde 403).
        branches = fresh.map(\.summary).filter { canAccessBranch($0.id) }
        let current = branches.first { $0.id == selectedBranchId }
        if current == nil || current?.isActive == false,
           let fallback = branches.first(where: \.isActive) {
            switchBranch(to: fallback)
        }
    }

    // MARK: Profil tazeleme

    /// Telefon doğrulama, rol değişikliği gibi durumlardan sonra.
    func reloadProfile() async {
        guard let refreshed = try? await services.auth.me() else { return }
        profile = refreshed
    }
}

/// Bildirimden açılan randevu — `.sheet(item:)` için kimlik sarmalayıcı.
struct AppointmentLink: Identifiable, Hashable {
    let id: String
}

// MARK: - Ortam anahtarı

extension EnvironmentValues {
    /// Ekranlar oturumu parametre zinciriyle taşımak yerine ortamdan alır.
    @Entry var appSession: AppSession?
}
