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
    /// Yalnız seçili şubede satılabilenleri göster. Varsayılan **kapalı**:
    /// tanım ekranı yönetim ekranı ve çoğu paket şube kısıtı taşımıyor.
    @State private var scopedToBranch = false

    private var store: PackageDefinitionStore { session.packageDefinitionStore }
    private var canWrite: Bool { session.can(Permissions.packageWrite) }

    /// Sunucuya gidecek kapsam. `nil` **tüm şubeler**.
    private var scope: String? { scopedToBranch ? session.selectedBranchId : nil }

    /// `.task(id:)` anahtarı: şube değişimi de kapsamı değiştiriyor.
    private var scopeKey: String { scope ?? "*" }

    /// Kapsam seçici — gövdede değil, üst çubuktaki seçenekler menüsünde.
    ///
    /// Segment seçici listenin üstünde kalıcı bir şerit kaplıyordu; oysa kapsam
    /// bir kez ayarlanıp unutulan bir tercih. Menü, `Pasifleri göster` ile aynı
    /// yerde duruyor çünkü ikisi de aynı soruyu soruyor: "listede ne görünsün?".
    ///
    /// Oturumun şube menüsüne KATILMADI: orası seçili şubeyi tüm uygulama için
    /// değiştirir, burası yalnız bu listenin kapsamı.
    @ViewBuilder
    private var scopeMenu: some View {
        if session.canSwitchBranch {
            Picker("Kapsam", selection: $scopedToBranch) {
                Text("Tüm şubeler").tag(false)
                Text(session.selectedBranch?.name ?? "Seçili şube").tag(true)
            }
        }
    }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            skeleton: .cards,
            emptyCheck: { $0.isEmpty },
            emptyTitle: "Henüz paket yok",
            emptyMessage: canWrite
                ? "İlk paketi tanımlayarak başlayın. Bir paket birden çok hizmet kalemi içerebilir."
                : "Paket tanımlamak için yöneticinizle görüşün.",
            emptyIcon: "shippingbox",
            emptyActionTitle: canWrite ? "Yeni paket" : nil,
            emptyAction: canWrite ? { editing = .create } : nil,
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
        // Üst çubukta ŞUBE SEÇİCİ YOK: başlık, arama alanı, şube menüsü ve
        // seçenekler menüsü aynı 44pt'lik şeride sığmıyordu — şube adı uzun
        // olan kiracıda başlık kırpılıyordu. Kapsam zaten "…" menüsünde ve bu
        // ekranın sorusu "hangi şubedeyim" değil, "listede ne görünsün".
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    scopeMenu
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
        // Kapsam ekranın kendi kararı: satış sayfası da kendi kapsamını
        // istiyor ve iki ekran birbirinin filtresini miras almamalı.
        .task(id: scopeKey) { await store.ensureScope(scope) }
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

    /// Şube adı; oturumda bulunamazsa (başka şubenin paketi) genel ifade.
    private func branchName(_ branchId: String) -> String {
        session.branches.first { $0.id == branchId }?.name ?? "Şubeye özel"
    }

    // MARK: Satır

    private func row(for definition: PackageDefinition) -> some View {
        Button {
            editing = .edit(definition)
        } label: {
            VStack(alignment: .leading, spacing: KlinaraMetrics.sm) {
                HStack(alignment: .firstTextBaseline, spacing: KlinaraMetrics.md) {
                    Text(definition.name)
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(Money.format(minor: definition.totalPriceMinor))
                        .klinaraText(.bodyEmphasis)
                        .foregroundStyle(KlinaraColor.charcoal)
                        .monospacedDigit()

                    // Üstü çizili liste fiyatı yalnız indirim varken: eşitken
                    // göstermek "indirim yok" mesajını gürültüye çevirirdi.
                    if definition.discountMinor != nil {
                        Text(Money.format(minor: definition.listPriceMinor))
                            .klinaraText(.bodyM)
                            .font(.footnote)
                            .strikethrough()
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                            .monospacedDigit()
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }

                // Kalem dökümü ile geçerlilik AYRI satırlarda: tek bir
                // noktalı dizide ikisi de okunmuyordu ve hangisinin nerede
                // bittiği belli olmuyordu.
                Text(contents(definition))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(validity(definition))
                    .klinaraText(.bodyM)
                    .font(.footnote)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Rozet sırası iki platformda SABİT: indirim → durum → şube →
                // online → devredilemez. Sıra değişirse aynı paket iki
                // uygulamada farklı okunur.
                if hasBadges(definition) {
                    HStack(spacing: KlinaraMetrics.xs) {
                        if let percent = definition.discountPercent {
                            KlinaraBadge(text: "%\(percent) indirim", tone: .positive, icon: "tag")
                        }
                        if definition.isArchived {
                            KlinaraBadge(text: "Arşiv", tone: .muted)
                        } else if !definition.isActive {
                            KlinaraBadge(text: "Pasif", tone: .muted)
                        }
                        // Rozet şubenin ADINI taşıyor: "şubeye özel" hangi şube
                        // olduğunu söylemiyordu.
                        if let scope = definition.branchId {
                            KlinaraBadge(text: branchName(scope), tone: .neutral)
                        }
                        if definition.isOnlineSellable {
                            KlinaraBadge(text: "Online", tone: .positive, icon: "globe")
                        }
                        if !definition.isTransferable {
                            KlinaraBadge(text: "Devredilemez", tone: .warning)
                        }
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
        // Kaydırma jesti VoiceOver kullanıcısına hiç görünmüyor; aynı eylem
        // bağlam menüsünde de duruyor (Android'de satır menüsü).
        .contextMenu {
            if canWrite, !definition.isArchived {
                Button(role: .destructive) {
                    pendingRetirement = definition
                } label: {
                    Label("Emekliye ayır", systemImage: "archivebox")
                }
            }
        }
    }

    private func hasBadges(_ definition: PackageDefinition) -> Bool {
        definition.discountPercent != nil
            || definition.isArchived
            || !definition.isActive
            || definition.branchId != nil
            || definition.isOnlineSellable
            || !definition.isTransferable
    }

    /// "12 seans · 10 Bölgesel Lazer, 2 Hydrafacial" — paketin İÇİ.
    private func contents(_ definition: PackageDefinition) -> String {
        var parts = ["\(definition.totalSessions) seans"]
        let items = definition.items
            .sorted { $0.sortOrder < $1.sortOrder }
            .map { "\($0.quantity) \($0.serviceName)" }
            .joined(separator: ", ")
        if !items.isEmpty { parts.append(items) }
        return parts.joined(separator: " · ")
    }

    /// Geçerlilik kendi satırında: paketin satılabilirliğini belirleyen ikinci
    /// bilgi o ve kalem dökümünün kuyruğunda kayboluyordu.
    private func validity(_ definition: PackageDefinition) -> String {
        definition.validityDays.map { "\($0) gün geçerli" } ?? "Süresiz"
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
