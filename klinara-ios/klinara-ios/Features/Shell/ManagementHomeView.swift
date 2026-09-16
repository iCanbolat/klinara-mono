import SwiftUI

/// Yönetim sekmesinin girişi — Faz 2'nin tüm ekranlarına açılan hub.
///
/// Düz bir liste yerine üç grup: **katalog** (ne satıyoruz), **ekip** (kim
/// yapıyor), **takvim kurulumu** (ne zaman yapılıyor). Bu ayrım kullanıcının
/// zihnindeki soruyla eşleşir; alfabetik bir liste eşleşmezdi.
struct ManagementHomeView: View {

    let session: AppSession

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    header

                    if session.can(Permissions.serviceRead) {
                        catalogCard
                    }
                    if session.can(Permissions.staffRead) {
                        teamCard
                    }
                    if session.can(Permissions.scheduleRead) {
                        scheduleCard
                    }
                    if session.can(Permissions.customerRead) {
                        customerCard
                    }
                    if session.can(Permissions.packageRead) {
                        packageCard
                    }
                    if session.canAny(
                        Permissions.notificationRead,
                        Permissions.notificationManage
                    ) {
                        communicationCard
                    }
                    if session.canAny(
                        Permissions.packageRead,
                        Permissions.reportRevenueRead,
                        Permissions.appointmentReadAll,
                        Permissions.reportPerformanceReadOwn
                    ) {
                        reportsCard
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Yönetim")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    BranchMenu(session: session)
                }
            }
        }
        .tint(KlinaraColor.sage)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
            Text(session.selectedBranch?.name ?? "Klinik")
                .klinaraText(.displayM)
                .foregroundStyle(KlinaraColor.charcoal)

            Text("Hizmetler, ekip ve çalışma saatleri buradan yönetilir.")
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

    /// İletişim ayrı bir kart, kasa gibi: gelen kutusu günlük bir resepsiyon
    /// işi ama sekme kümesi Faz 3'te donduruldu ve bilgi mimarisini her fazda
    /// yeniden kurmak kullanıcının kas hafızasını sıfırlamak demek.
    ///
    /// Dipnot Ek M'in en çok yanlış anlaşılan kararını görünür kılıyor:
    /// işlemsel/pazarlama ayrımı olayın tanımında, kiracı ayarında değil.
    private var communicationCard: some View {
        KlinaraCard(
            title: "İletişim",
            footnote: "Randevu hatırlatması ticari ileti değildir; iletişim izni iptali yalnız pazarlama mesajlarını durdurur."
        ) {
            if session.can(Permissions.notificationRead) {
                KlinaraNavigationRow(
                    label: "Gelen kutusu",
                    detail: "Müşterilerin WhatsApp'tan yazdığı mesajlar",
                    icon: "tray.and.arrow.down"
                ) {
                    InboxView(session: session)
                }
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Mesaj günlüğü",
                    detail: "Gönderilen, ulaşan ve gönderilmeyen mesajlar",
                    icon: "bubble.left.and.text.bubble.right"
                ) {
                    MessageLogView(session: session)
                }
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
                    detail: "Olay ve kanal başına mesaj metni",
                    icon: "text.quote"
                ) {
                    NotificationTemplateListView(session: session)
                }
                KlinaraDivider()
                KlinaraNavigationRow(
                    label: "Bildirim tercihleri",
                    detail: "Kanal önceliği ve sessiz saatler",
                    icon: "slider.horizontal.3"
                ) {
                    NotificationPreferenceListView(session: session)
                }
            }
            if session.can(Permissions.notificationManage) {
                if session.can(Permissions.notificationRead) {
                    KlinaraDivider()
                }
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
            if session.canAny(
                Permissions.appointmentReadAll,
                Permissions.reportRevenueRead,
                Permissions.reportPerformanceReadOwn
            ) {
                KlinaraNavigationRow(
                    label: "Klinik raporları",
                    detail: "Doluluk, ciro, personel performansı, gelmeme ve kazanım",
                    icon: "chart.line.uptrend.xyaxis"
                ) {
                    ReportsHomeView(session: session)
                }
                KlinaraDivider()
            }
            if session.canAny(Permissions.packageRead, Permissions.reportRevenueRead) {
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
            title: "Takvim kurulumu",
            footnote: session.selectedBranch.map {
                "Saatler \($0.name) şubesinin saat diliminde (\($0.timezone)) gösterilir."
            }
        ) {
            KlinaraNavigationRow(
                label: "Şube çalışma saatleri",
                detail: "Açılış, kapanış ve mola",
                icon: "clock"
            ) {
                BranchHoursView(session: session)
            }
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
