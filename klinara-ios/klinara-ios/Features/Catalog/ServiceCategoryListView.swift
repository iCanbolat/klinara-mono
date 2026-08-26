import SwiftUI

/// Kategori listesi — sırasıyla birlikte.
///
/// Sıra hizmet listesindeki grup düzenini belirlediği için sürükle-bırak ile
/// değiştirilir; ayrı bir "sıra numarası" alanı kullanıcıyı üç kategoride bile
/// hesap yapmaya zorlardı.
struct ServiceCategoryListView: View {

    let session: AppSession

    @State private var editing: CategoryEditorSheet.Target?
    @State private var pendingDeactivation: ServiceCategory?
    @State private var reorderError: APIError?

    private var store: CatalogStore { session.catalogStore }
    private var canWrite: Bool { session.can(Permissions.serviceWrite) }

    var body: some View {
        KlinaraScreen(
            state: store.state,
            emptyCheck: { $0.categories.isEmpty },
            emptyTitle: "Kategori yok",
            emptyMessage: "Hizmetler kategori altında gruplanır. Önce bir kategori ekleyin.",
            emptyIcon: "folder",
            onRetry: { await store.reload() }
        ) { catalog in
            if let reorderError {
                ErrorBanner(error: reorderError)
            }

            KlinaraCard(footnote: canWrite ? "Sıralamak için basılı tutup sürükleyin." : nil) {
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
        .confirmationDialog(
            "Kategori pasife alınsın mı?",
            isPresented: .init(
                get: { pendingDeactivation != nil },
                set: { if !$0 { pendingDeactivation = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Pasife al", role: .destructive) {
                guard let target = pendingDeactivation else { return }
                pendingDeactivation = nil
                Task { try? await store.deactivateCategory(id: target.id) }
            }
            Button("Vazgeç", role: .cancel) { pendingDeactivation = nil }
        } message: {
            Text("Kayıt silinmez, pasife alınır. Bu kategorideki hizmetler listede kalır.")
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
                    if canWrite {
                        reorderButtons(for: category, in: ordered)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                }
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            if canWrite, category.isActive {
                Button(role: .destructive) {
                    pendingDeactivation = category
                } label: {
                    Label("Pasife al", systemImage: "archivebox")
                }
            }
        }
    }

    /// Sürükle-bırak yerine yukarı/aşağı düğmeleri: `ForEach` bir `List`
    /// içinde değil (kart düzeni gerektiği için), `onMove` burada çalışmaz.
    /// Üç-beş kategoride bu yeterli ve erişilebilirlik açısından daha iyi.
    private func reorderButtons(
        for category: ServiceCategory,
        in ordered: [ServiceCategory]
    ) -> some View {
        let index = ordered.firstIndex(of: category) ?? 0
        return HStack(spacing: 2) {
            Button {
                Task { await move(category, in: ordered, by: -1) }
            } label: {
                Image(systemName: "chevron.up")
            }
            .disabled(index == 0)
            .accessibilityLabel("Yukarı taşı")

            Button {
                Task { await move(category, in: ordered, by: 1) }
            } label: {
                Image(systemName: "chevron.down")
            }
            .disabled(index == ordered.count - 1)
            .accessibilityLabel("Aşağı taşı")
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(KlinaraColor.sageDeep)
        .buttonStyle(.plain)
    }

    private func move(_ category: ServiceCategory, in ordered: [ServiceCategory], by offset: Int) async {
        guard
            let index = ordered.firstIndex(of: category),
            ordered.indices.contains(index + offset)
        else { return }

        let neighbour = ordered[index + offset]
        reorderError = nil
        do {
            // İki kaydın sırası takas edilir. Tüm listeyi yeniden numaralamak
            // sunucuya N istek atmak demekti.
            _ = try await store.updateCategory(
                id: category.id,
                UpdateServiceCategoryInput(sortOrder: neighbour.sortOrder)
            )
            _ = try await store.updateCategory(
                id: neighbour.id,
                UpdateServiceCategoryInput(sortOrder: category.sortOrder)
            )
        } catch {
            reorderError = error as? APIError ?? .network
            // İlk istek geçip ikincisi düşmüş olabilir; kesin doğru sırayı
            // sunucudan yeniden okuyoruz.
            await store.reload()
        }
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
