import SwiftUI

/// Meta'da tanımlı WhatsApp template'leri.
///
/// Bu liste **bizim yazdığımız metinler değil**: Meta'da onaya gönderilmiş ve
/// onaylanmış şablonlar. Bildirim şablonu ekranındaki metinle karıştırılmaması
/// için ayrı bir ekran ve açık bir dipnot (Ek M: WhatsApp metni bizden gitmiyor).
struct WhatsAppTemplateListView: View {

    let session: AppSession
    let store: WhatsAppStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                content
            }
            .padding(.horizontal, KlinaraMetrics.screenInset)
            .padding(.vertical, KlinaraMetrics.lg)
        }
        .background(KlinaraColor.surface)
        .navigationTitle("Onaylı şablonlar")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadTemplates() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.templatesState {
        case .loading:
            ProgressView()
                .tint(KlinaraColor.sage)
                .frame(maxWidth: .infinity)
                .padding(.vertical, KlinaraMetrics.xl)

        case .failed(let error):
            ErrorBanner(error: error, onRetry: { Task { await store.loadTemplates() } })

        case .loaded(let templates):
            if templates.isEmpty {
                EmptyStateView(
                    icon: "checkmark.seal",
                    title: "Şablon yok",
                    message: "Bağlantıyı doğruladığınızda Meta'daki şablonlar buraya senkronlanır."
                )
            } else {
                KlinaraCard(
                    title: "Meta şablonları",
                    footnote: "Bu metinler Meta'da tanımlıdır ve buradan değiştirilemez. Onay süreci Meta Business Manager'dan yürür."
                ) {
                    ForEach(Array(templates.enumerated()), id: \.element.rowId) { index, template in
                        if index > 0 { KlinaraDivider() }
                        row(template)
                    }
                }
            }
        }
    }

    private func row(_ template: WhatsAppTemplate) -> some View {
        VStack(alignment: .leading, spacing: KlinaraMetrics.xs) {
            HStack(spacing: KlinaraMetrics.sm) {
                Text(template.name)
                    .klinaraText(.bodyEmphasis)
                    .foregroundStyle(KlinaraColor.charcoal)
                    .frame(maxWidth: .infinity, alignment: .leading)

                KlinaraBadge(text: template.status.turkishName, tone: template.status.badgeTone)
            }

            Text([template.language.uppercased(), template.category]
                .compactMap { $0 }
                .joined(separator: " · "))
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(template.bodyVariableCount == 0
                ? "Değişken beklemiyor"
                : "\(template.bodyVariableCount) değişken bekliyor ({{1}}…{{\(template.bodyVariableCount)}})")
                .klinaraText(.bodyM)
                .font(.footnote)
                .foregroundStyle(KlinaraColor.charcoalMuted)
                .frame(maxWidth: .infinity, alignment: .leading)

            if !template.buttons.isEmpty {
                FlowLayout(spacing: KlinaraMetrics.xs) {
                    ForEach(Array(template.buttons.enumerated()), id: \.offset) { _, button in
                        KlinaraBadge(text: button.text, tone: .neutral)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let syncedAt = template.syncedAt {
                Text("Senkron: \(session.clock.formatDateTime(syncedAt))")
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(KlinaraMetrics.md)
    }
}
