import SwiftUI

/// WhatsApp entegrasyonunun durumu ve kurulumu.
///
/// Yapılandırılmamış hesapta sunucu gövdeyi düpedüz `null` döndürüyor; ekran
/// bunu bir **boş durum** olarak gösterir, hata olarak değil. Kırmızı bir
/// bantla karşılanan kullanıcı, henüz yapmadığı bir şeyin bozulduğunu sanırdı.
struct WhatsAppSettingsView: View {

    let session: AppSession

    @State private var store: WhatsAppStore?
    @State private var isEditing = false
    @State private var isTesting = false
    @State private var error: APIError?

    private var canSend: Bool { session.can(Permissions.notificationSend) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }
                    content(store)
                } else {
                    ProgressView()
                        .tint(KlinaraColor.sage)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, KlinaraMetrics.xl)
                }
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("WhatsApp entegrasyonu")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard store == nil else { return }
            let created = WhatsAppStore(service: session.services.whatsapp)
            store = created
            await created.loadAccount()
            if created.isConfigured { await created.loadTemplates() }
        }
        .overlay {
            if store?.isVerifying == true {
                AuthLoadingOverlay(message: "Bağlantı doğrulanıyor…")
            }
        }
        .sheet(isPresented: $isEditing) {
            if let store {
                WhatsAppSettingsEditorView(session: session, store: store)
            }
        }
        .sheet(isPresented: $isTesting) {
            if let store {
                WhatsAppTestSheet(store: store)
            }
        }
    }

    @ViewBuilder
    private func content(_ store: WhatsAppStore) -> some View {
        switch store.accountState {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.xl)

        case .failed(let failure):
            ErrorBanner(error: failure, onRetry: { Task { await store.loadAccount() } })

        case .loaded(let account):
            if let account {
                statusCard(account, store: store)
                verifyResultCard(store)
                actionsCard(store)
            } else {
                EmptyStateView(
                    icon: "link",
                    title: "WhatsApp bağlı değil",
                    message: "Meta Business hesabınızın WABA kimliği, telefon numarası kimliği ve erişim token'ı gerekir.",
                    actionTitle: "Yapılandır",
                    action: { isEditing = true }
                )
            }
        }
    }

    private func statusCard(_ account: WhatsAppAccount, store: WhatsAppStore) -> some View {
        KlinaraCard(title: "Durum") {
            HStack {
                Text("Bağlantı")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                Spacer()
                KlinaraBadge(text: account.status.turkishName, tone: account.status.badgeTone)
            }
            // ``KlinaraCard`` içeriğine yatay boşluk EKLEMEZ; serbest içerik
            // dolgusunu kendisi taşır (``KlinaraRow`` ile aynı `md`).
            .padding(KlinaraMetrics.md)
            KlinaraDivider()
            KlinaraRow(label: "WABA kimliği", value: account.wabaId, isMonospaced: true)
            KlinaraDivider()
            KlinaraRow(label: "Telefon numarası kimliği", value: account.phoneNumberId, isMonospaced: true)
            if let phone = account.businessPhone {
                KlinaraDivider()
                KlinaraRow(label: "İşletme numarası", value: phone)
            }
            KlinaraDivider()
            KlinaraRow(label: "API sürümü", value: account.apiVersion)
            KlinaraDivider()
            // Ham token hiçbir yanıtta yok; maskeli değer yalnız "hangi
            // token'ı girdim?" sorusunu ayırt etmeye yarar.
            KlinaraRow(
                label: "Erişim token'ı",
                value: account.accessTokenMasked,
                detail: "Token okunamaz; değiştirmek için yeniden girilmelidir."
            )
            KlinaraDivider()
            KlinaraRow(
                label: "Webhook imzası",
                value: account.canVerifyWebhooks ? "Doğrulanabilir" : "App secret yok",
                // İmza doğrulanamazsa gelen kutusu hiç dolmaz — kurulumun en
                // sık gözden kaçan eksiği bu.
                detail: account.canVerifyWebhooks
                    ? nil
                    : "App secret girilmeden gelen mesajlar işlenmez; gelen kutusu boş kalır."
            )
            if let verifiedAt = account.lastVerifiedAt {
                KlinaraDivider()
                KlinaraRow(
                    label: "Son doğrulama",
                    value: session.clock.formatDateTime(verifiedAt)
                )
            }
            if let lastError = account.lastError {
                KlinaraDivider()
                KlinaraRow(label: "Son hata", value: lastError)
            }
        }
    }

    @ViewBuilder
    private func verifyResultCard(_ store: WhatsAppStore) -> some View {
        if let result = store.lastVerifyResult {
            KlinaraCard(title: "Doğrulama sonucu") {
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    HStack {
                        Text(result.ok ? "Bağlantı doğrulandı" : "Bağlantı doğrulanamadı")
                            .klinaraText(.bodyEmphasis)
                            .foregroundStyle(KlinaraColor.charcoal)
                        Spacer()
                        KlinaraBadge(
                            text: result.ok ? "Başarılı" : "Başarısız",
                            tone: result.ok ? .positive : .warning
                        )
                    }
                    if let message = result.error {
                        Text(message)
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoal)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if result.ok {
                        Text("Senkronlanan şablon: \(result.templateCount)")
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(KlinaraMetrics.md)
            }
        }
    }

    private func actionsCard(_ store: WhatsAppStore) -> some View {
        KlinaraCard(title: "İşlemler") {
            KlinaraNavigationRow(
                label: "Onaylı şablonlar",
                detail: "Meta'dan senkronlanan template'ler ve onay durumları",
                icon: "checkmark.seal"
            ) {
                WhatsAppTemplateListView(session: session, store: store)
            }
            KlinaraDivider()
            VStack(spacing: KlinaraMetrics.sm) {
                KlinaraButton(
                    title: "Bağlantıyı doğrula",
                    kind: .secondary,
                    icon: "checkmark.shield",
                    isLoading: store.isVerifying,
                    isEnabled: !store.isVerifying
                ) {
                    Task { await verify(store) }
                }
                if canSend {
                    KlinaraButton(
                        title: "Test mesajı gönder",
                        kind: .secondary,
                        icon: "paperplane",
                        isEnabled: !store.isVerifying
                    ) {
                        isTesting = true
                    }
                }
                KlinaraButton(
                    title: "Kimlik bilgilerini güncelle",
                    kind: .secondary,
                    icon: "key",
                    isEnabled: !store.isVerifying
                ) {
                    isEditing = true
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private func verify(_ store: WhatsAppStore) async {
        error = nil
        do {
            try await store.verify()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
