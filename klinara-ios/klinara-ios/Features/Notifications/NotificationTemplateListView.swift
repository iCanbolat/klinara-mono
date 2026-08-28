import SwiftUI

/// Bildirim şablonları — olay ve kanal başına mesaj metni.
///
/// Liste **olaya göre gruplu**: kanal kanal düz bir sıra, "randevu hatırlatması
/// hangi metinle gidiyor?" sorusunu üç ayrı satıra bölerdi. Kullanıcı olayı
/// düşünür, kanalı sonra seçer.
///
/// Sunucu birleştirilmiş **etkin görünüm** döndürüyor: kiracının kendi satırı
/// olmayan çiftler kod varsayılanıyla gelir ve `isDefault` ile işaretlenir.
/// Bu yüzden ekranda "ekle" yok — eklenecek bir şey yok, var olan düzenlenir.
struct NotificationTemplateListView: View {

    let session: AppSession

    @State private var store: NotificationSettingsStore?
    @State private var editing: NotificationTemplate?

    private var canWrite: Bool { session.can(Permissions.notificationManage) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                if let store {
                    if !canWrite {
                        Text("Şablonları görüntüleyebilirsiniz; değiştirmek için bildirim yönetimi izni gerekir.")
                            .klinaraText(.bodyM)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .fixedSize(horizontal: false, vertical: true)
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
        .navigationTitle("Bildirim şablonları")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard store == nil else { return }
            let created = NotificationSettingsStore(service: session.services.notifications)
            store = created
            await created.loadTemplates()
        }
        .sheet(item: $editing) { template in
            if let store {
                NotificationTemplateEditorView(
                    session: session,
                    store: store,
                    template: template
                )
            }
        }
    }

    @ViewBuilder
    private func content(_ store: NotificationSettingsStore) -> some View {
        switch store.templatesState {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.xl)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.loadTemplates() } })

        case .loaded:
            let groups = store.templatesByEvent
            if groups.isEmpty {
                EmptyStateView(
                    icon: "text.quote",
                    title: "Şablon yok",
                    message: "Sunucu hiçbir olay için şablon döndürmedi."
                )
            } else {
                ForEach(groups, id: \.event) { group in
                    KlinaraCard(
                        title: group.event.turkishName,
                        footnote: group.event.explanation
                    ) {
                        ForEach(Array(group.templates.enumerated()), id: \.element.rowId) { index, template in
                            if index > 0 { KlinaraDivider() }
                            row(template)
                        }
                    }
                }
            }
        }
    }

    private func row(_ template: NotificationTemplate) -> some View {
        Button {
            editing = template
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
                HStack(spacing: KlinaraMetrics.sm) {
                    Label(template.channel.turkishName, systemImage: template.channel.icon)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)

                    Spacer(minLength: 0)

                    if template.isDefault {
                        KlinaraBadge(text: "Varsayılan", tone: .muted)
                    }
                    if !template.isActive {
                        KlinaraBadge(text: "Pasif", tone: .warning)
                    }
                    // Sağlayıcısı olmayan kanallar (SMS, push) kaydedilebilir
                    // ama gönderim yapmaz; şablonu düzenleyip mesajın neden
                    // gitmediğini aramak kullanıcının işi olmamalı.
                    if !template.channel.isDeliverable {
                        KlinaraBadge(text: "Kanal kurulu değil", tone: .muted)
                    }
                }

                Text(template.body.isEmpty ? "(metin yok)" : template.body)
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let name = template.whatsappTemplateName {
                    Text("Meta şablonu: \(name)")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}
