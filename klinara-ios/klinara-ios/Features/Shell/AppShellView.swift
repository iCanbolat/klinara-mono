import SwiftUI

/// Oturum açıldıktan sonraki uygulama kabuğu.
///
/// Sekme kümesi **kalıcıdır**: Faz 3 ve Faz 4 sekme eklemez, var olan sekmeyi
/// doldurur. Bilgi mimarisini her fazda yeniden kurmak, kullanıcının kas
/// hafızasını her sürümde sıfırlamak demektir.
///
/// Sekmeler **izne göre** çizilir. Yetkisi olmayan bir kullanıcıya sekmeyi
/// gösterip içeride 403 vermek, ona yapamayacağı bir şeyi vaat etmektir.
struct AppShellView: View {

    @Bindable var authFlow: AuthFlowModel
    let session: AppSession

    @State private var selection = Tabs.today

    private enum Tabs: Hashable {
        case today, customers, management, profile
    }

    /// Yönetim sekmesi Faz 2'nin tamamını barındırır; üç izinden herhangi biri
    /// yeter (yalnız çalışma saatlerini düzenleyen bir yönetici de girebilmeli).
    private var showsManagement: Bool {
        session.canAny(Permissions.serviceRead, Permissions.staffRead, Permissions.scheduleRead)
    }

    /// `accountant` rolünde hiç randevu izni yok. Sekme yine de duruyor —
    /// varsayılan seçili sekmenin bazı rollerde kaybolması bilgi mimarisini
    /// role göre değiştirmek olurdu — ama içerik "erişimin yok" der.
    private var canSeeCalendar: Bool {
        session.canAny(Permissions.appointmentReadAll, Permissions.appointmentReadOwn)
    }

    var body: some View {
        TabView(selection: $selection) {
            Tab("Bugün", systemImage: "calendar", value: Tabs.today) {
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
                        .navigationTitle("Bugün")
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
    static let userRead = "user:read"
}
