import SwiftUI

/// Kategori listesi — sırasıyla birlikte.
///
/// Sıra hizmet listesindeki grup düzenini belirlediği için sürükle-bırak ile
/// değiştirilir; ayrı bir "sıra numarası" alanı kullanıcıyı üç kategoride bile
/// hesap yapmaya zorlardı.
///
/// **Satırda aksiyon yok.** Daha önce her satırda yukarı/aşağı düğmeleri, chevron
/// ve `List` dışında hiç çalışmayan bir `swipeActions` vardı; satır bir liste
/// öğesi değil kontrol paneli gibi okunuyordu. Pasife alma artık kategorinin
/// kendi sayfasında — yıkıcı bir aksiyon listede tek dokunuş uzaklıkta durmamalı
/// (Android `ServiceCategoryListScreen` ile aynı karar).
struct ServiceCategoryListView: View {

    let session: AppSession

    @State private var editing: CategoryEditorSheet.Target?
    @State private var reorderError: APIError?

    private var store: CatalogStore { session.catalogStore }
    private var canWrite: Bool { session.can(Permissions.serviceWrite) }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            skeleton: .rows,
            emptyCheck: { $0.categories.isEmpty },
            emptyTitle: "Kategori yok",
            emptyMessage: "Hizmetler kategori altında gruplanır. Önce bir kategori ekleyin.",
            emptyIcon: "folder",
            emptyActionTitle: canWrite ? "Yeni kategori" : nil,
            emptyAction: canWrite ? { editing = .create } : nil,
            onRetry: { await store.reload() }
        ) { catalog in
            if let reorderError {
                ErrorBanner(error: reorderError)
            }

            KlinaraCard(footnote: canWrite ? "Sıralamak için satırı basılı tutup sürükleyin." : nil) {
                let ordered = catalog.categories.sorted { $0.sortOrder < $1.sortOrder }
                ForEach(Array(ordered.enumerated()), id: \.element.id) { index, category in
                    if index > 0 { KlinaraDivider() }
                    row(for: category, in: ordered)
                }
            }
        }
        .navigationTitle("Kategoriler")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editing = .create } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Yeni kategori")
                }
            }
        }
        .task { await store.load() }
        .refreshable { await store.reload() }
        .sheet(item: $editing) { target in
            CategoryEditorSheet(session: session, target: target)
        }
    }

    private func row(for category: ServiceCategory, in ordered: [ServiceCategory]) -> some View {
        let serviceCount = store.catalog.services
            .filter { $0.categoryId == category.id && $0.isActive }
            .count

        return Button {
            editing = .edit(category)
        } label: {
            KlinaraRow(
                label: category.name,
                value: "\(serviceCount) hizmet",
                detail: category.slug
            ) {
                HStack(spacing: KlinaraMetrics.sm) {
                    if !category.isActive {
                        KlinaraBadge(text: "Pasif", tone: .muted)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
        }
        .buttonStyle(.plain)
        .draggable(canWrite ? category.id : "")
        .dropDestination(for: String.self) { items, _ in
            guard canWrite, let sourceId = items.first, sourceId != category.id else { return false }
            Task { await move(sourceId: sourceId, onto: category, in: ordered) }
            return true
        }
        .accessibilityActions {
            if canWrite {
                reorderAccessibilityActions(for: category, in: ordered)
            }
        }
    }

    /// Sürükleme motor beceri ister; sıralamanın tek yolu olamaz. Görsel oklar
    /// kalktı, VoiceOver yolu kalkmadı.
    @ViewBuilder
    private func reorderAccessibilityActions(
        for category: ServiceCategory,
        in ordered: [ServiceCategory]
    ) -> some View {
        let index = ordered.firstIndex(of: category) ?? 0
        if index > 0 {
            Button("Yukarı taşı") {
                Task { await move(sourceId: category.id, onto: ordered[index - 1], in: ordered) }
            }
        }
        if index < ordered.count - 1 {
            Button("Aşağı taşı") {
                Task { await move(sourceId: category.id, onto: ordered[index + 1], in: ordered) }
            }
        }
    }

    /// [sourceId] kategorisini [target]'ın bulunduğu konuma taşır.
    ///
    /// Komşuyla takas değil **yeniden numaralama**: sürükleme bitişik olmayan bir
    /// hedefe bırakılabiliyor ve art arda takas etmek aradaki her kayda iki yazma
    /// demekti. Yalnız sırası gerçekten değişen kayıtlar yazılır.
    private func move(
        sourceId: String,
        onto target: ServiceCategory,
        in ordered: [ServiceCategory]
    ) async {
        guard
            let from = ordered.firstIndex(where: { $0.id == sourceId }),
            let to = ordered.firstIndex(of: target),
            from != to
        else { return }

        var reordered = ordered
        reordered.insert(reordered.remove(at: from), at: to)
        let previous = Dictionary(uniqueKeysWithValues: ordered.map { ($0.id, $0.sortOrder) })

        reorderError = nil
        do {
            for (index, category) in reordered.enumerated() where previous[category.id] != index {
                _ = try await store.updateCategory(
                    id: category.id,
                    UpdateServiceCategoryInput(sortOrder: index)
                )
            }
        } catch {
            reorderError = error as? APIError ?? .network
        }
        // Yazmalardan biri düşmüş olabilir; kesin doğru sırayı sunucudan okuyoruz.
        await store.reload()
    }
}

/// Kategori oluşturma/düzenleme sayfası.
struct CategoryEditorSheet: View {

    enum Target: Identifiable {
        case create
        case edit(ServiceCategory)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let category): category.id
            }
        }

        var existing: ServiceCategory? {
            if case .edit(let category) = self { return category }
            return nil
        }
    }

    let session: AppSession
    let target: Target

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var slug: String
    @State private var isActive: Bool
    @State private var slugIsCustom: Bool
    @State private var error: APIError?
    @State private var isConfirmingDeactivation = false

    private var store: CatalogStore { session.catalogStore }
    private var isReadOnly: Bool { !session.can(Permissions.serviceWrite) }

    init(session: AppSession, target: Target) {
        self.session = session
        self.target = target
        _name = State(initialValue: target.existing?.name ?? "")
        _slug = State(initialValue: target.existing?.slug ?? "")
        _isActive = State(initialValue: target.existing?.isActive ?? true)
        _slugIsCustom = State(initialValue: target.existing != nil)
    }

    var body: some View {
        KlinaraFormScaffold(
            title: target.existing == nil ? "Yeni kategori" : "Kategoriyi düzenle",
            canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty && Slug.isValid(slug),
            isDirty: isDirty,
            isReadOnly: isReadOnly,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            KlinaraFormSection {
                VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                    KlinaraTextField(
                        label: "Kategori adı",
                        text: $name,
                        placeholder: "Epilasyon",
                        error: error?.fieldErrors["name"],
                        autocapitalization: .words
                    )
                    .onChange(of: name) { _, newValue in
                        guard !slugIsCustom else { return }
                        slug = Slug.make(from: newValue)
                    }

                    KlinaraTextField(
                        label: "Kod (slug)",
                        text: $slug,
                        placeholder: "epilasyon",
                        error: slugMessage ?? error?.fieldErrors["slug"]
                    )
                    .onChange(of: slug) { _, newValue in
                        if newValue != Slug.make(from: name) { slugIsCustom = true }
                    }
                }
                .padding(KlinaraMetrics.md)

                KlinaraDivider()
                KlinaraToggleRow(label: "Aktif", isOn: $isActive, isEnabled: !isReadOnly)
            }

            if let existing = target.existing, existing.isActive, !isReadOnly {
                Button("Pasife al", role: .destructive) { isConfirmingDeactivation = true }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, KlinaraMetrics.sm)

                Text("Aktif hizmeti olan kategori pasife alınamaz.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
            }
        }
        .confirmationDialog(
            "Kategori pasife alınsın mı?",
            isPresented: $isConfirmingDeactivation,
            titleVisibility: .visible
        ) {
            Button("Pasife al", role: .destructive) {
                guard let existing = target.existing else { return }
                Task {
                    do {
                        _ = try await store.deactivateCategory(id: existing.id)
                        dismiss()
                    } catch {
                        // Sunucu 409 veriyor (kategoride aktif hizmet var). Yutmak,
                        // kullanıcının neden olmadığını hiç öğrenmemesi olurdu.
                        self.error = error as? APIError ?? .network
                    }
                }
            }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Kayıt silinmez, pasife alınır. Bu kategorideki hizmetler listede kalır.")
        }
    }

    private var slugMessage: String? {
        guard !slug.isEmpty, !Slug.isValid(slug) else { return nil }
        return "Yalnız küçük harf, rakam ve tire; 3-50 karakter."
    }

    private var isDirty: Bool {
        guard let existing = target.existing else { return !name.isEmpty || !slug.isEmpty }
        return name != existing.name || slug != existing.slug || isActive != existing.isActive
    }

    private func save() async {
        error = nil
        do {
            if let existing = target.existing {
                _ = try await store.updateCategory(
                    id: existing.id,
                    UpdateServiceCategoryInput(slug: slug, name: name, isActive: isActive)
                )
            } else {
                _ = try await store.createCategory(
                    CreateServiceCategoryInput(
                        slug: slug,
                        name: name,
                        sortOrder: store.catalog.categories.count,
                        isActive: isActive
                    )
                )
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
