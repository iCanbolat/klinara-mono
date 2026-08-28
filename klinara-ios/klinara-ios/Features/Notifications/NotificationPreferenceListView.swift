import SwiftUI

/// Bildirim tercihleri — hangi olay hangi kanaldan, hangi öncelikle gider ve
/// sessiz saatler nedir.
///
/// İki bölüm ayrı: **kiracı varsayılanı** ve **bu şubeye özel**. Tek listede
/// karışmaları, kullanıcının bir şubeye yazdığını tüm klinik için yaptığını
/// sanmasıyla biterdi — sunucu satırları `(event, branchId)` ile ayırıyor,
/// ekran da ayırmalı.
struct NotificationPreferenceListView: View {

    let session: AppSession

    @State private var store: NotificationSettingsStore?
    @State private var editing: NotificationPreference?

    private var canWrite: Bool { session.can(Permissions.notificationManage) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
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
        .navigationTitle("Bildirim tercihleri")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                BranchMenu(session: session)
            }
        }
        .task {
            guard store == nil else { return }
            let created = NotificationSettingsStore(service: session.services.notifications)
            store = created
            await created.loadPreferences()
        }
        .sheet(item: $editing) { preference in
            if let store {
                NotificationPreferenceEditorView(
                    session: session,
                    store: store,
                    preference: preference
                )
            }
        }
    }

    @ViewBuilder
    private func content(_ store: NotificationSettingsStore) -> some View {
        switch store.preferencesState {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.xl)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.loadPreferences() } })

        case .loaded:
            let tenant = store.tenantPreferences
            let branch = session.selectedBranchId.map(store.branchPreferences(branchId:)) ?? []

            if tenant.isEmpty && branch.isEmpty {
                EmptyStateView(
                    icon: "slider.horizontal.3",
                    title: "Tercih yok",
                    message: "Sunucu hiçbir olay için tercih döndürmedi."
                )
            } else {
                if !branch.isEmpty {
                    KlinaraCard(
                        title: "\(session.selectedBranch?.name ?? "Şube") için özel",
                        footnote: "Bu satırlar kiracı varsayılanını yalnız bu şubede ezer."
                    ) {
                        rows(branch)
                    }
                }

                KlinaraCard(
                    title: "Kiracı varsayılanı",
                    footnote: "Şubeye özel bir satır yoksa bu ayarlar geçerlidir."
                ) {
                    rows(tenant)
                }
            }
        }
    }

    @ViewBuilder
    private func rows(_ preferences: [NotificationPreference]) -> some View {
        ForEach(Array(preferences.enumerated()), id: \.element.rowId) { index, preference in
            if index > 0 { KlinaraDivider() }
            row(preference)
        }
    }

    private func row(_ preference: NotificationPreference) -> some View {
        Button {
            editing = preference
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(spacing: KlinaraMetrics.sm) {
                    Text(preference.event.turkishName)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if preference.kind == .marketing {
                        KlinaraBadge(text: "Pazarlama", tone: .warning)
                    }
                    if preference.isDefault {
                        KlinaraBadge(text: "Varsayılan", tone: .muted)
                    }
                }

                // Boş kanal listesi "olay kapalı" demek; bunu bir tire ile
                // geçmek, kapalı bir bildirimi açık sanmakla sonuçlanırdı.
                Text(preference.isEnabled
                    ? preference.channels.map(\.turkishName).joined(separator: " → ")
                    : "Kapalı")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(
                        preference.isEnabled ? KlinaraColor.charcoalMuted : KlinaraColor.danger
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let quiet = preference.quietHoursLabel {
                    Text("Sessiz saat: \(quiet)")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!canWrite)
    }
}
