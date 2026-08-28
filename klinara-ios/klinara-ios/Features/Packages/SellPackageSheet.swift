import SwiftUI

/// Paket satışı: tanım seç → önizle → sat.
///
/// **Idempotency anahtarı sheet açılışında üretilir ve satış boyunca sabit
/// kalır.** Ağ hatasından sonra kullanıcının tekrar "Sat"a basması çok olası
/// bir senaryo; her denemede yeni anahtar üretilseydi müşteri iki paket
/// satın almış olurdu.
struct SellPackageSheet: View {

    let session: AppSession
    let store: CustomerPackagesStore

    @Environment(\.dismiss) private var dismiss

    @State private var selectedId: String?
    @State private var note = ""
    @State private var error: APIError?
    /// Sheet ömrü boyunca tek anahtar — `@State` olması kasıtlı.
    @State private var idempotencyKey = UUID().uuidString

    private var definitionStore: PackageDefinitionStore { session.packageDefinitionStore }

    private var options: [PackageDefinition] {
        definitionStore.sellable(in: session.selectedBranchId)
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private var selected: PackageDefinition? {
        options.first { $0.id == selectedId }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KlinaraMetrics.lg) {
                    if let error, !error.isFieldScoped {
                        ErrorBanner(error: error)
                    }

                    switch definitionStore.state {
                    case .loading:
                        ProgressView()
                            .tint(KlinaraColor.sage)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, KlinaraMetrics.xl)

                    case .failed(let failure):
                        ErrorBanner(error: failure, onRetry: { Task { await definitionStore.reload() } })

                    case .loaded:
                        if options.isEmpty {
                            EmptyStateView(
                                icon: "shippingbox",
                                title: "Satılabilir paket yok",
                                message: "Bu şubede satışa açık paket tanımı bulunmuyor."
                            )
                        } else {
                            picker
                            if let selected { preview(selected) }
                            noteCard
                            sellButton
                        }
                    }
                }
                .padding(.horizontal, KlinaraMetrics.screenInset)
                .padding(.vertical, KlinaraMetrics.lg)
            }
            .background(KlinaraColor.surface)
            .navigationTitle("Paket sat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Vazgeç") { dismiss() }
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
            .task { await definitionStore.load() }
            .overlay {
                if store.isSaving { AuthLoadingOverlay(message: "Satış kaydediliyor…") }
            }
        }
        .tint(KlinaraColor.sage)
    }

    // MARK: Bölümler

    private var picker: some View {
        KlinaraSearchablePicker(
            title: "Paket",
            options: options,
            label: { $0.name },
            detail: { "\($0.totalSessions) seans · \(Money.format(minor: $0.totalPriceMinor))" },
            isSelected: { $0.id == selectedId },
            onSelect: { selectedId = $0.id },
            searchPrompt: "Paket ara",
            emptyMessage: "Aramanızla eşleşen paket yok."
        )
    }

    /// Satışta ne olacağı **satmadan önce** görünmeli: kalemler, süre ve
    /// devredilebilirlik satış anında dondurulur, sonradan düzeltilemez.
    private func preview(_ definition: PackageDefinition) -> some View {
        KlinaraCard(title: "Satış önizlemesi", footnote: previewFootnote(definition)) {
            ForEach(Array(definition.items.sorted { $0.sortOrder < $1.sortOrder }.enumerated()), id: \.element.id) { index, item in
                if index > 0 { KlinaraDivider() }
                KlinaraRow(
                    label: item.serviceName,
                    value: "\(item.quantity) seans",
                    detail: Money.format(minor: item.unitListPriceMinor) + " birim"
                )
            }
            KlinaraDivider()
            KlinaraRow(
                label: "Satış tutarı",
                value: Money.format(minor: definition.totalPriceMinor),
                detail: definition.discountMinor.map {
                    "Liste: \(Money.format(minor: definition.listPriceMinor)) · İndirim: \(Money.format(minor: $0))"
                }
            )
        }
    }

    private func previewFootnote(_ definition: PackageDefinition) -> String {
        var parts: [String] = []
        parts.append(definition.validityDays.map { "Satıştan itibaren \($0) gün geçerli" }
            ?? "Süresiz")
        parts.append(definition.isTransferable ? "Devredilebilir" : "Devredilemez")
        parts.append("Satış anındaki fiyat ve kalemler dondurulur; tanım sonradan değişse bile bu paket etkilenmez.")
        return parts.joined(separator: " · ")
    }

    private var noteCard: some View {
        KlinaraCard(title: "Not") {
            KlinaraTextEditor(
                label: "Satış notu",
                text: $note,
                placeholder: "İsteğe bağlı",
                error: error?.fieldErrors["note"],
                minHeight: 80
            )
            .padding(KlinaraMetrics.md)
        }
    }

    private var sellButton: some View {
        KlinaraButton(
            title: "Paketi sat",
            kind: .primary,
            icon: "cart.badge.plus",
            isLoading: store.isSaving,
            isEnabled: selectedId != nil && !store.isSaving
        ) {
            Task { await sell() }
        }
    }

    // MARK: Eylem

    private func sell() async {
        guard let definitionId = selectedId else { return }
        error = nil
        do {
            let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await store.sell(
                definitionId: definitionId,
                note: trimmed.isEmpty ? nil : trimmed,
                idempotencyKey: idempotencyKey
            )
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
