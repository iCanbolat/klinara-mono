import SwiftUI

/// Oturum açıldıktan sonraki uygulama kabuğu.
///
/// Sekme kümesi **kalıcıdır**: Faz 3 ve Faz 4 sekme eklemez, var olan sekmeyi
/// doldurur. Bilgi mimarisini her fazda yeniden kurmak, kullanıcının kas
/// hafızasını her sürümde sıfırlamak demektir.
///
/// **Dashboard bu kuralın bilinçli istisnası** ve AÇILIŞ sekmesi: web panelin
/// açılış sayfasının karşılığı. Önce Yönetim hub'ının bir kartıydı; günün ilk
/// sorusuna üç dokunuşla ulaşmak açılış ekranı olmasının önüne geçiyordu. Eski
/// "Bugün" sekmesi aynı anda "Takvim" adını aldı.
///
/// Sekmeler **izne göre** çizilir. Yetkisi olmayan bir kullanıcıya sekmeyi
/// gösterip içeride 403 vermek, ona yapamayacağı bir şeyi vaat etmektir.
struct AppShellView: View {

    @Bindable var authFlow: AuthFlowModel
    let session: AppSession

    @State private var selection = Tabs.dashboard
    @Environment(\.scenePhase) private var scenePhase
    private var push: PushCoordinator { PushCoordinator.shared }

    private enum Tabs: Hashable {
        case dashboard, calendar, customers, management, profile
    }

    /// Yönetim sekmesi, içindeki kartlardan en az biri görünüyorsa çizilir —
    /// kart kuralları tek yerde (``ManagementAccess``), web menüsüyle aynı.
    private var showsManagement: Bool {
        ManagementAccess(session: session).any
    }

    /// Randevu izni olmayan bir rolde sekme yine de duruyor —
    /// varsayılan seçili sekmenin bazı rollerde kaybolması bilgi mimarisini
    /// role göre değiştirmek olurdu — ama içerik "erişimin yok" der.
    private var canSeeCalendar: Bool {
        session.canAny(Permissions.appointmentReadAll, Permissions.appointmentReadOwn)
    }

    var body: some View {
        TabView(selection: $selection) {
            // Dashboard her rolde çizilir; izin yoksa içerik "erişiminiz yok" der
            // (Takvim sekmesiyle aynı gerekçe).
            Tab("Dashboard", systemImage: "square.grid.2x2", value: Tabs.dashboard) {
                DashboardView(session: session) { selection = .calendar }
            }

            Tab("Takvim", systemImage: "calendar", value: Tabs.calendar) {
                if canSeeCalendar {
                    CalendarHomeView(session: session)
                } else {
                    NavigationStack {
                        EmptyStateView(
                            icon: "calendar",
                            title: "Takvim erişiminiz yok",
                            message: "Rolünüz randevuları görüntülemeyi kapsamıyor."
                        )
                        .background(KlinaraColor.surface)
                        .navigationTitle("Takvim")
                        .navigationBarTitleDisplayMode(.inline)
                    }
                    .tint(KlinaraColor.sage)
                }
            }

            if session.can(Permissions.customerRead) {
                Tab("Müşteriler", systemImage: "person.2", value: Tabs.customers) {
                    CustomerListView(session: session)
                }
            }

            if showsManagement {
                Tab("Yönetim", systemImage: "slider.horizontal.3", value: Tabs.management) {
                    ManagementHomeView(session: session)
                }
            }

            Tab("Profil", systemImage: "person.crop.circle", value: Tabs.profile) {
                ProfileView(authFlow: authFlow, session: session)
            }
        }
        .tint(KlinaraColor.sage)
        .environment(\.appSession, session)
        .task {
            session.becameActive(refresh: false)
            // Push izni ve kaydı oturum açıldıktan sonra; personel bildirimi
            // görme izni yoksa push'un da anlamı yok (sunucu da reddeder).
            if session.can(Permissions.notificationRead) {
                await push.activate(service: session.services.push)
            }
        }
        .onDisappear { session.resignedActive() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: session.becameActive(refresh: true)
            case .background: session.resignedActive()
            default: break
            }
        }
        // Bildirime dokunuldu (uygulama kapalıyken de: rota açılışta bekliyor).
        .onChange(of: push.pendingRoute, initial: true) { _, route in
            guard let route else { return }
            push.pendingRoute = nil
            open(route)
        }
    }

    private func open(_ route: PushRoute) {
        switch route {
        case .appointment(let id):
            guard canSeeCalendar else { return }
            selection = .calendar
            session.linkedAppointment = AppointmentLink(id: id)
        case .home:
            break
        }
    }
}

/// `packages/shared/src/permissions.ts` içindeki izin anahtarları.
///
/// Elle yazılmış metinler yerine sabitler: bir izin adı yanlış yazıldığında
/// kontrol sessizce `false` döner ve sekme hiç görünmez — fark edilmesi zor,
/// sebebi bulunması daha da zor bir hatadır.
enum Permissions {
    static let serviceRead = "service:read"
    static let serviceWrite = "service:write"
    static let staffRead = "staff:read"
    static let staffWrite = "staff:write"
    static let scheduleRead = "schedule:read"
    static let scheduleWrite = "schedule:write"
    static let customerRead = "customer:read"
    static let customerWrite = "customer:write"
    /// Birleştirme FK taşıyan ve geri alınması pahalı bir işlem; `owner` ve
    /// `manager`da var, resepsiyonda yok.
    static let customerMerge = "customer:merge"
    /// Klinik notu ve fotoğraf sağlık verisidir (KVKK m.6): ayrı izin.
    static let customerMedicalRead = "customer.medical:read"
    static let customerMedicalWrite = "customer.medical:write"
    static let appointmentReadAll = "appointment:read.all"
    static let appointmentReadOwn = "appointment:read.own"
    static let appointmentWrite = "appointment:write"
    /// `completed`tan çıkış izni. `owner` ve `manager`da var, `receptionist`te yok.
    static let appointmentReopen = "appointment:reopen"
    static let branchRead = "branch:read"
    /// Şube ekleme/düzenleme/pasife alma — yalnız `owner`.
    static let branchWrite = "branch:write"
    static let userRead = "user:read"
    /// Rol değiştirme `user:write` VEYA `user:invite` ile açık (sunucu
    /// `RequireAnyPermission`); şube yöneticisi yalnız `invite` taşıyor.
    static let userWrite = "user:write"
    static let userInvite = "user:invite"
    static let packageRead = "package:read"
    /// Paket SATIŞI ve seans düzenleme — resepsiyonda da var.
    static let packageWrite = "package:write"
    /// Paket TANIMI (katalog) yazma — yalnız sahip ve şube yöneticisi.
    /// `package:write` üzerine binmez: resepsiyon satar ama tanımı değiştiremez.
    static let packageDefinitionWrite = "package_definition:write"
    /// İade ve devir `package:write` üzerine **binmez**. Gerekçe `customer:merge`
    /// ile aynı: geri alınması pahalı, paraya dokunan işlemlerin resepsiyonun
    /// günlük yazma iznine binmesi yetkisiz iade demektir.
    static let packageRefund = "package:refund"
    static let packageTransfer = "package:transfer"
    /// Parasal rapor izni. Yükümlülük raporu ve süre dolumu listesindeki tutar
    /// alanları buna bakar — izin yoksa sunucu tutarı `null` döner.
    static let reportRevenueRead = "report.revenue:read"
    /// Uygulayıcının YALNIZ kendi performans raporu (10.1).
    ///
    /// `report.revenue:read` üzerine binmez ve onun dar bir hâli değildir: tek
    /// başına hiçbir şubenin cirosunu açmaz. Daraltmayı sunucu yapıyor ve
    /// yanıttaki `scope` alanı bunu söylüyor.
    static let reportPerformanceReadOwn = "report.performance:read.own"
    /// Mesaj günlüğü, gelen kutusu, şablon ve hatırlatma ayarlarının okunması (Faz 8).
    static let notificationRead = "notification:read"
    /// Tek tek mesaj gönderme ve gelen mesajı işlendi işaretleme. `manage`
    /// üzerine **binmez**: resepsiyon test mesajı atabilir ama kiracının
    /// şablonunu değiştiremez. Sunucudaki ayrımın aynısı.
    static let notificationSend = "notification:send"
    /// Şablon, bildirim tercihi, hatırlatma ayarı ve WhatsApp kimlik bilgileri.
    /// `send`i **kapsamaz**: şablonu yöneten bir kullanıcı mesaj göndermek
    /// zorunda değil.
    static let notificationManage = "notification:manage"
    static let consentRead = "consent:read"
    /// Onam METİNLERİNİ düzenleme; imza toplamak (`consent:collect`) buna binmez.
    static let consentManage = "consent:manage"
    static let consentCollect = "consent:collect"
}
