import SwiftUI

/// Müşteri etiketlerinin yönetimi — Yönetim sekmesinden açılır.
///
/// Etiketler **kiracı kapsamlıdır**, şube değil: bir şubede oluşturulan etiket
/// diğerinde de görünür. Tekillik sunucuda **katlanmış ada** göre — "VIP",
/// "Vip" ve "vıp" aynı etikettir; kullanıcının aynı şeyi üç kez oluşturabilmesi
/// etiketin işe yaramaması demekti.
struct CustomerTagListView: View {

    let session: AppSession

    @State private var editing: TagTarget?
    @State private var deleting: CustomerTag?
    @State private var error: APIError?

    private var store: CustomerStore { session.customerStore }
    private var canWrite: Bool { session.can(Permissions.customerWrite) }

    private enum TagTarget: Identifiable {
        case create
        case edit(CustomerTag)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let tag): tag.id
            }
        }

        var existing: CustomerTag? {
            if case .edit(let tag) = self { return tag }
            return nil
        }
    }

    var body: some View {
        KlinaraScreen(
            state: store.tagState,
            emptyCheck: \.isEmpty,
            emptyTitle: "Etiket yok",
            emptyMessage: canWrite
                ? "Sağ üstteki artı ile ilk etiketi oluşturun."
                : "Henüz etiket tanımlanmamış.",
            emptyIcon: "tag",
            onRetry: { await store.loadTags(force: true) }
        ) { tags in
            if let error {
                ErrorBanner(error: error)
            }

            KlinaraCard(
                title: "Etiketler",
                footnote: "Etiket adları büyük/küçük harf ve Türkçe karakter "
                    + "farkı gözetmeden tekildir."
            ) {
                ForEach(Array(tags.enumerated()), id: \.element.id) { index, tag in
                    if index > 0 { KlinaraDivider() }
                    Button {
                        guard canWrite else { return }
                        editing = .edit(tag)
                    } label: {
                        KlinaraRow(label: tag.name) {
                            HStack(spacing: KlinaraMetrics.sm) {
                                Circle()
                                    .fill(CustomerTagChip.color(tag.color))
                                    .frame(width: 12, height: 12)
                                if canWrite {
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(KlinaraColor.charcoalMuted)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!canWrite)
                }
            }
        }
        .navigationTitle("Müşteri etiketleri")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canWrite {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editing = .create } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Yeni etiket")
                }
            }
        }
        .task { await store.loadTags() }
        .sheet(item: $editing) { target in
            CustomerTagEditorView(
                session: session,
                existing: target.existing,
                onDelete: { tag in deleting = tag }
            )
        }
        .confirmationDialog(
            "Etiket silinsin mi?",
            isPresented: .init(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Sil", role: .destructive) {
                if let tag = deleting { Task { await delete(tag) } }
            }
            Button("Vazgeç", role: .cancel) { deleting = nil }
        } message: {
            Text("Etiket tüm müşteri kartlarından kalkar. Müşteri kayıtları etkilenmez.")
        }
    }

    private func delete(_ tag: CustomerTag) async {
        error = nil
        do {
            try await store.deleteTag(id: tag.id)
        } catch {
            self.error = error as? APIError ?? .network
        }
        deleting = nil
    }
}

// MARK: - Etiket formu

/// Tek etiketin oluşturma / düzenleme sayfası.
struct CustomerTagEditorView: View {

    let session: AppSession
    let existing: CustomerTag?
    var onDelete: ((CustomerTag) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var color: String?
    @State private var error: APIError?

    private var store: CustomerStore { session.customerStore }
    private var fieldErrors: [String: String] { error?.fieldErrors ?? [:] }

    init(session: AppSession, existing: CustomerTag?, onDelete: ((CustomerTag) -> Void)? = nil) {
        self.session = session
        self.existing = existing
        self.onDelete = onDelete
        _name = State(initialValue: existing?.name ?? "")
        _color = State(initialValue: existing?.color)
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isDirty: Bool {
        trimmedName != (existing?.name ?? "") || color != existing?.color
    }

    var body: some View {
        KlinaraFormScaffold(
            title: existing == nil ? "Yeni etiket" : "Etiketi düzenle",
            canSave: !trimmedName.isEmpty,
            isDirty: isDirty,
            isReadOnly: false,
            isSaving: store.isSaving,
            error: error,
            onSave: save
        ) {
            KlinaraFormSection(title: "Etiket") {
                KlinaraTextField(
                    label: "Ad",
                    text: $name,
                    placeholder: "VIP",
                    error: fieldErrors["name"],
                    autocapitalization: .words
                )
                .padding(KlinaraMetrics.md)

                KlinaraDivider()

                ColorSwatchPicker(label: "Renk", hex: $color)
                    .padding(KlinaraMetrics.md)
            }

            if let existing, let onDelete {
                KlinaraButton(title: "Etiketi sil", kind: .tertiary, icon: "trash") {
                    dismiss()
                    onDelete(existing)
                }
            }
        }
    }

    private func save() async {
        error = nil
        let input = CustomerTagInput(name: trimmedName, color: color)
        do {
            if let existing {
                _ = try await store.updateTag(id: existing.id, input)
            } else {
                _ = try await store.createTag(input)
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
