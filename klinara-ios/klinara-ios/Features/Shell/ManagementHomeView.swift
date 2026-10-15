import SwiftUI

/// Yönetim kartlarının hangi rolde görüneceği — web menüsünün
/// (`apps/web-admin/src/lib/permissions.ts` `NAV_ITEMS`) ve Android
/// `ManagementAccess` paritesi.
///
/// Kapılar "veriyi okuyabiliyor mu" değil "bu ekran onun işi mi" sorusuna
/// bakar: `staff:read`, `service:read`, `notification:read` HER rolde var
/// (randevu formu ve zil için), ama uygulayıcının ekip, katalog ya da şablon
/// yönetimiyle işi yok.
@MainActor
struct ManagementAccess {
    let catalog: Bool
    let team: Bool
    let schedule: Bool
    let customerTags: Bool
    let packages: Bool
    let communication: Bool
    let reports: Bool
    let packageReports: Bool
    /// Uygulayıcı: takvim kurulumunda yalnız kendi programı.
    let ownOnly: Bool

    init(session: AppSession) {
        let readAll = session.can(Permissions.appointmentReadAll)
        catalog = session.can(Permissions.serviceRead) && readAll
        team = session.can(Permissions.staffRead)
            && session.canAny(Permissions.userRead, Permissions.staffWrite)
        schedule = session.can(Permissions.scheduleRead)
        customerTags = session.can(Permissions.customerWrite)
        packages = session.can(Permissions.packageRead) && readAll
        communication = session.canAny(Permissions.notificationSend, Permissions.notificationManage)
        reports = readAll || session.canAny(
            Permissions.reportRevenueRead,
            Permissions.reportPerformanceReadOwn
        )
        packageReports = packages || session.can(Permissions.reportRevenueRead)
        ownOnly = session.isOwnScope
    }

    var any: Bool {
        catalog || team || schedule || customerTags || packages || communication || reports
    }
}

/// Yönetim sekmesinin girişi — Faz 2'nin tüm ekranlarına açılan hub.
///
/// Düz bir liste yerine üç grup: **katalog** (ne satıyoruz), **ekip** (kim
/// yapıyor), **takvim kurulumu** (ne zaman yapılıyor). Bu ayrım kullanıcının
/// zihnindeki soruyla eşleşir; alfabetik bir liste eşleşmezdi.
struct ManagementHomeView: View {

    let session: AppSession

    /// Sohbetler satırındaki rozet; hub'a her dönüşte tazelenir.
    @State private var unreadConversations: Int?

    private var access: ManagementAccess { ManagementAccess(session: session) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    header

                    if access.catalog {
                        catalogCard
                    }
                    if access.team {
                        teamCard
                    }
                    if access.schedule {
                        scheduleCard
                    }
                    if access.customerTags {
                        customerCard
                    }
                    if access.packages {
                        packageCard
                    }
                    if access.communication {
                        communicationCard
                    }
                    if access.reports || access.packageReports {
                        reportsCard
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Yönetim")
            .navigationBarTitleDisplayMode(.inline)
            .task { await loadUnreadConversations() }
            // Uygulayıcının "Çalışma programım" satırı kendi profiline gider.
            .task { if access.ownOnly { await session.staffStore.load() } }
            .toolbar {
                RootToolbarTitle(title: "Yönetim")
                ToolbarItem(placement: .topBarTrailing) {
                    BranchMenu(session: session)
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private func loadUnreadConversations() async {
        guard session.can(Permissions.notificationSend) else { return }
        // Rozet süs: hata sessizce yutulur, satır rozetsiz kalır.
        unreadConversations = try? await session.services.conversations.unreadCount()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text(session.selectedBranch?.name ?? "Klinik")
                .klinaraText(.displayM)
                .foregroundStyle(KlinaraColor.charcoal)

            Text(access.ownOnly
                ? "Çalışma programınız ve performansınız."
                : "Hizmetler, ekip ve çalışma saatleri buradan yönetilir.")
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var catalogCard: some View {
        KlinaraCard(title: "Katalog") {
            KlinaraNavigationRow(
                label: "Hizmetler",
                detail: "Süre, hazırlık payı, fiyat ve şube farkları",
                icon: "list.bullet.rectangle"
            ) {
                ServiceListView(session: session)
            }
            KlinaraDivider()
            KlinaraNavigationRow(
                label: "Kategoriler",
                detail: "Hizmetlerin gruplanması ve sırası",
                icon: "folder"
            ) {
                ServiceCategoryListView(session: session)
            }
        }
    }

    /// "Şube ve Personel": web panelindeki ekranın karşılığı. Şubeler ve
    /// davetler personelin yanında, çünkü "kim, nerede, hangi rolle" tek soru.
    private var teamCard: some View {
        KlinaraCard(
            title: "Şube ve Personel",
            footnote: "Bir personele yetkin olmadığı hizmetten randevu açılamaz."
        ) {
            KlinaraNavigationRow(
                label: "Personel",
                detail: "Profil, roller, şubeler ve hizmet yetkinlikleri",
                icon: "person.text.rectangle"
            ) {
                StaffListView(session: session)
            }
            if session.can(Permissions.branchRead) {
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Şubeler",
                    value: "\(session.switchableBranches.filter(\.isActive).count)",
                    detail: session.can(Permissions.branchWrite)
                        ? "Şube ekleme, iletişim ve pasife alma"
                        : "Kliniğin şubeleri",
                    icon: "building.2"
                ) {
                    BranchListView(session: session)
                }
            }
            if session.can(Permissions.userInvite) {
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Davetler",
                    detail: "Yeni personel davet et, bekleyenleri iptal et",
                    icon: "envelope.badge"
                ) {
                    InvitationListView(session: session)
                }
            }
        }
    }

    /// Etiketler kiracı kapsamlı ve müşteri kartından değil buradan yönetilir:
    /// bir kartın içinde etiket **seçilir**, tanımlanmaz.
    private var customerCard: some View {
        KlinaraCard(title: "Müşteri") {
            KlinaraNavigationRow(
                label: "Müşteri etiketleri",
                detail: "VIP, hassas cilt, kampanya…",
                icon: "tag"
            ) {
                CustomerTagListView(session: session)
            }
        }
    }

    /// Paketler kataloğun altında değil ayrı bir kartta: bir paket hizmet
    /// değil, hizmet **hakkı** satar ve muhasebesi kataloğunkinden farklı.
    private var packageCard: some View {
        KlinaraCard(
            title: "Paketler",
            footnote: "Tanım değişikliği satılmış paketleri etkilemez; satış anındaki snapshot geçerlidir."
        ) {
            KlinaraNavigationRow(
                label: "Paket tanımları",
                detail: "Kalemler, fiyat, geçerlilik ve devir kuralı",
                icon: "shippingbox"
            ) {
                PackageDefinitionListView(session: session)
            }
        }
    }

    /// İletişim ayrı bir kart, kasa gibi: sohbetler günlük bir resepsiyon
    /// işi ama sekme kümesi Faz 3'te donduruldu ve bilgi mimarisini her fazda
    /// yeniden kurmak kullanıcının kas hafızasını sıfırlamak demek.
    private var communicationCard: some View {
        KlinaraCard(title: "İletişim") {
            if session.can(Permissions.notificationSend) {
                KlinaraNavigationRow(
                    label: "Sohbetler",
                    value: unreadConversations.flatMap { $0 > 0 ? "\($0) okunmamış" : nil },
                    detail: "Müşterilerle WhatsApp yazışmaları",
                    icon: "bubble.left.and.bubble.right"
                ) {
                    ConversationListView(session: session)
                }
                KlinaraDivider()
            }
            KlinaraNavigationRow(
                label: "Mesaj günlüğü",
                detail: "Gönderilen, ulaşan ve gönderilmeyen mesajlar",
                icon: "bubble.left.and.text.bubble.right"
            ) {
                MessageLogView(session: session)
            }
            // Hatırlatma ve şablonlar kiracının TÜM müşterilerine giden
            // mesajları değiştirir: yönetenlerin (sahip, şube yöneticisi) işi.
            if session.can(Permissions.notificationManage) {
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Hatırlatma ayarları",
                    detail: "Randevudan kaç saat önce, gelmedi takibi",
                    icon: "bell.badge"
                ) {
                    ReminderSettingsView(session: session)
                }
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Bildirim şablonları",
                    detail: "Müşteriye giden mesajlar ve açık/kapalı durumları",
                    icon: "text.quote"
                ) {
                    NotificationTemplateListView(session: session)
                }
            }
            if session.can(Permissions.notificationManage) {
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "WhatsApp entegrasyonu",
                    detail: "WABA kimlik bilgileri, şablonlar ve test gönderimi",
                    icon: "link"
                ) {
                    WhatsAppSettingsView(session: session)
                }
            }
        }
    }

    private var reportsCard: some View {
        KlinaraCard(title: "Raporlar") {
            if access.reports {
                KlinaraNavigationRow(
                    label: access.ownOnly ? "Performansım" : "Klinik raporları",
                    detail: access.ownOnly
                        ? "Kendi işlem sayınız, ciro ve doluluğunuz"
                        : "Doluluk, ciro, personel performansı, gelmeme ve kazanım",
                    icon: "chart.line.uptrend.xyaxis"
                ) {
                    ReportsHomeView(session: session)
                }
                if access.packageReports { KlinaraDivider() }
            }
            if access.packageReports {
                KlinaraNavigationRow(
                    label: "Paket raporları",
                    detail: "Taşınan yükümlülük, süre dolumu ve dönem kullanımı",
                    icon: "chart.bar.doc.horizontal"
                ) {
                    PackageReportsHomeView(session: session)
                }
            }
        }
    }

    private var scheduleCard: some View {
        KlinaraCard(
            title: access.ownOnly ? "Çalışma saatleri" : "Takvim kurulumu",
            footnote: session.selectedBranch.map {
                "Saatler \($0.name) şubesinin saat diliminde (\($0.timezone)) gösterilir."
            }
        ) {
            if access.ownOnly, let own = session.ownStaffProfile {
                KlinaraNavigationRow(
                    label: "Çalışma programım",
                    detail: "Haftalık çalışma saatleriniz",
                    icon: "person.badge.clock"
                ) {
                    StaffScheduleView(session: session, staffProfileId: own.id)
                }
                KlinaraDivider()
            }
            KlinaraNavigationRow(
                label: "Şube çalışma saatleri",
                detail: "Açılış, kapanış ve mola",
                icon: "clock"
            ) {
                BranchHoursView(session: session)
            }
            if !access.ownOnly {
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "İzin ve istisnalar",
                    detail: "Tatil, yarım gün, tekrarlı izinler",
                    icon: "calendar.badge.exclamationmark"
                ) {
                    ScheduleExceptionListView(session: session)
                }
            }
        }
    }
}
