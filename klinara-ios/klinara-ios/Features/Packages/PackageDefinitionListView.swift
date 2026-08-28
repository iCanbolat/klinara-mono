import SwiftUI

/// Paket tanımları — kliniğin satabildiği şablonlar (Batch 5.1).
///
/// Liste **fiyatı ve indirimi** öne çıkarır: bir paketin var olma sebebi
/// kampanyalı fiyatıdır, kalem dökümü ikinci sıradadır.
struct PackageDefinitionListView: View {

    let session: AppSession

    @State private var searchText = ""
    @State private var showsInactive = false
    @State private var editing: PackageDefinitionEditorView.Target?
    @State private var pendingRetirement: PackageDefinition?
    @State private var error: APIError?

    private var store: PackageDefinitionStore { session.packageDefinitionStore }
    private var canWrite: Bool { session.can(Permissions.packageWrite) }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            emptyCheck: { $0.isEmpty },
            emptyTitle: "Henüz paket yok",
            emptyMessage: canWrite
                ? "İlk paketi tanımlayarak başlayın. Bir paket birden çok hizmet kalemi içerebilir."
                : "Paket tanımlamak için yöneticinizle görüşün.",
            emptyIcon: "shippingbox",
            onRetry: { await store.reload() }
        ) { definitions in
            if let error, !error.isFieldScoped {
                ErrorBanner(error: error)
            }

            let visible = filtered(definitions)

            if visible.isEmpty {
                Text("Aramanızla eşleşen paket yok.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, KlinaraMetrics.xl)
            }

            ForEach(visible) { definition in
                KlinaraCard {
                    row(for: definition)
                }
            }

            if store.nextCursor != nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KlinaraMetrics.md)
                    .onAppear { Task { await store.loadMore() } }
            }
        }
        .navigationTitle("Paketler")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Paket ara")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle("Pasifleri göster", isOn: $showsInactive)
                    if canWrite {
                        Button {
                            editing = .create
                        } label: {
                            Label("Yeni paket", systemImage: "plus")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Seçenekler")
            }
        }
        .task { await store.load() }
        .refreshable { await store.reload() }
        .sheet(item: $editing) { target in
            PackageDefinitionEditorView(session: session, target: target)
        }
        .confirmationDialog(
            "Paket emekliye ayrılsın mı?",
            isPresented: .init(
                get: { pendingRetirement != nil },
                set: { if !$0 { pendingRetirement = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Emekliye ayır", role: .destructive) {
                guard let target = pendingRetirement else { return }
                pendingRetirement = nil
                Task { await retire(target) }
            }
            Button("Vazgeç", role: .cancel) { pendingRetirement = nil }
        } message: {
            // İki ayrı sonuç var ve hangisinin olacağını satış geçmişi
            // belirliyor; kullanıcı "sildim" sanmasın.
            Text("Paket hiç satılmadıysa arşivlenir, satıldıysa yalnız pasife alınır. Satılmış paketler ve müşteri hakları etkilenmez.")
        }
    }

    // MARK: Satır

    private func row(for definition: PackageDefinition) -> some View {
        Button {
            editing = .edit(definition)
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                HStack(alignment: .top, spacing: KlinaraMetrics.md) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(definition.name)
                            .klinaraText(.bodyEmphasis)
                            .foregroundStyle(KlinaraColor.charcoal)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text(summary(definition))
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Money.format(minor: definition.totalPriceMinor))
                            .klinaraText(.bodyEmphasis)
                            .foregroundStyle(KlinaraColor.charcoal)
                            .monospacedDigit()

                        // Üstü çizili liste fiyatı yalnız indirim varken:
                        // eşitken göstermek "indirim yok" mesajını gürültüye çevirirdi.
                        if definition.discountMinor != nil {
                            Text(Money.format(minor: definition.listPriceMinor))
                                .klinaraText(.bodyM)
                                .font(.footnote)
                                .strikethrough()
                                .foregroundStyle(KlinaraColor.charcoalMuted)
                                .monospacedDigit()
                        }
                    }
                    .fixedSize()
                    .layoutPriority(1)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .padding(.top, 4)
                }

                HStack(spacing: KlinaraMetrics.xs) {
                    if let percent = definition.discountPercent {
                        KlinaraBadge(text: "%\(percent) indirim", tone: .positive, icon: "tag")
                    }
                    if definition.isArchived {
                        KlinaraBadge(text: "Arşiv", tone: .muted)
                    } else if !definition.isActive {
                        KlinaraBadge(text: "Pasif", tone: .muted)
                    }
                    if definition.branchId != nil {
                        KlinaraBadge(text: "Şubeye özel", tone: .neutral)
                    }
                    if definition.isOnlineSellable {
                        KlinaraBadge(text: "Online", tone: .positive, icon: "globe")
                    }
                    if !definition.isTransferable {
                        KlinaraBadge(text: "Devredilemez", tone: .warning)
                    }
                }
            }
            .padding(KlinaraMetrics.md)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            if canWrite, !definition.isArchived {
                Button(role: .destructive) {
                    pendingRetirement = definition
                } label: {
                    Label("Emekliye ayır", systemImage: "archivebox")
                }
            }
        }
    }

    /// "12 seans · 10 Bölgesel Lazer, 2 Hydrafacial · 365 gün geçerli".
    /// Geçerlilik süresi burada duruyor çünkü paketin satılabilirliğini
    /// belirleyen ikinci bilgi o.
    private func summary(_ definition: PackageDefinition) -> String {
        var parts = ["\(definition.totalSessions) seans"]
        let items = definition.items
            .sorted { $0.sortOrder < $1.sortOrder }
            .map { "\($0.quantity) \($0.serviceName)" }
            .joined(separator: ", ")
        if !items.isEmpty { parts.append(items) }
        parts.append(definition.validityDays.map { "\($0) gün geçerli" } ?? "Süresiz")
        return parts.joined(separator: " · ")
    }

    // MARK: Eylem

    private func retire(_ definition: PackageDefinition) async {
        error = nil
        do {
            try await store.retire(id: definition.id, version: definition.version)
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    // MARK: Filtre

    private func filtered(_ definitions: [PackageDefinition]) -> [PackageDefinition] {
        definitions
            .filter { showsInactive || ($0.isActive && !$0.isArchived) }
            .filter { definition in
                guard !searchText.isEmpty else { return true }
                return definition.name.localizedCaseInsensitiveContains(searchText)
                    || definition.slug.localizedCaseInsensitiveContains(searchText)
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}
