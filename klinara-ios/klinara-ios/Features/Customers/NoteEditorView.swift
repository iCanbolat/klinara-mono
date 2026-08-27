import SwiftUI

/// Not ekleme / düzenleme sayfası.
///
/// Tür seçimi **izne göre daralır**: `customer.medical:write` olmadan yalnız
/// serbest not yazılabilir. Sunucu da aynı kuralı uyguluyor (`403`); buradaki
/// daraltma kullanıcıya basınca hata alacağı seçeneği hiç göstermemek için.
struct NoteEditorView: View {

    let session: AppSession
    let record: CustomerRecordStore
    /// `nil` ise yeni not.
    let existing: CustomerNote?
    /// Randevuya bağlı işlem notu açılırken.
    var appointmentId: String?

    @Environment(\.dismiss) private var dismiss
    @State private var body_: String
    @State private var kind: CustomerNoteKind
    @State private var customerVisible: Bool
    @State private var error: APIError?
    @State private var deleting = false
    @State private var showsRevisions = false

    /// Düzenlemeye girildiği andaki sürüm. Kaydetmeden önce sunucudaki sürüm
    /// bundan büyükse başkası araya girmiş demektir.
    private let openedVersion: Int?

    init(
        session: AppSession,
        record: CustomerRecordStore,
        existing: CustomerNote?,
        appointmentId: String? = nil
    ) {
        self.session = session
        self.record = record
        self.existing = existing
        self.appointmentId = appointmentId ?? existing?.appointmentId
        _body_ = State(initialValue: existing?.body ?? "")
        _kind = State(initialValue: existing?.kind ?? .general)
        _customerVisible = State(initialValue: existing?.customerVisible ?? false)
        openedVersion = existing?.version
    }

    private var trimmed: String {
        body_.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canWriteClinical: Bool { session.can(Permissions.customerMedicalWrite) }

    /// Seçilebilir türler. Klinik yazma izni yoksa yalnız serbest not.
    private var availableKinds: [CustomerNoteKind] {
        canWriteClinical ? CustomerNoteKind.allCases : [.general]
    }

    private var isDirty: Bool {
        trimmed != (existing?.body ?? "")
            || kind != (existing?.kind ?? .general)
            || customerVisible != (existing?.customerVisible ?? false)
    }

    /// Not, düzenlemeye girildiğinden beri başkası tarafından değiştirildi mi.
    ///
    /// Bu bir **kilit değil, uyarı**: sunucuda bu uçta `If-Match` yok ve son
    /// yazan kazanıyor. Revizyon geçmişi veri kaybını engelliyor, çakışmayı
    /// değil — kullanıcıya böyle söyleniyor.
    private var wasChangedElsewhere: Bool {
        guard let openedVersion, let current = existing.map(\.version) else { return false }
        return current > openedVersion
    }

    var body: some View {
        KlinaraFormScaffold(
            title: existing == nil ? "Yeni not" : "Notu düzenle",
            canSave: !trimmed.isEmpty,
            isDirty: isDirty,
            isReadOnly: false,
            isSaving: record.isSaving,
            error: error,
            onSave: save
        ) {
            if wasChangedElsewhere {
                ErrorBanner(error: .problem(ProblemDetails(
                    code: .conflict,
                    title: "Bu not siz açtıktan sonra değiştirildi",
                    detail: "Kaydederseniz son hâli sizinki olur; eski metin geçmişte kalır.",
                    status: 409
                )))
            }

            noteSection
            optionsSection

            if let existing {
                historySection(existing)
            }
        }
        .confirmationDialog(
            "Not silinsin mi?",
            isPresented: $deleting,
            titleVisibility: .visible
        ) {
            Button("Sil", role: .destructive) { Task { await delete() } }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Not arşivlenir; zaman çizelgesinden kalkar.")
        }
        .sheet(isPresented: $showsRevisions) {
            if let existing {
                NoteRevisionsView(session: session, record: record, note: existing)
            }
        }
    }

    private var noteSection: some View {
        KlinaraFormSection(
            title: "Not",
            footnote: appointmentId == nil ? nil : "Bu not bir randevuya bağlı."
        ) {
            KlinaraTextEditor(
                label: "Metin",
                text: $body_,
                placeholder: "Cilt reaksiyonu gözlenmedi.",
                error: error?.fieldErrors["body"]
            )
            .padding(KlinaraMetrics.md)
        }
    }

    @ViewBuilder
    private var optionsSection: some View {
        KlinaraFormSection(
            title: "Tür",
            footnote: canWriteClinical
                ? "İşlem ve iç notlar sağlık verisidir; yalnız klinik izni olan "
                    + "kullanıcılara görünür."
                : "Klinik notu yazma yetkiniz yok; not serbest not olarak kaydedilir."
        ) {
            Picker("Tür", selection: $kind) {
                ForEach(availableKinds) { value in
                    Text(value.turkishName).tag(value)
                }
            }
            .pickerStyle(.segmented)
            .padding(KlinaraMetrics.md)
            .disabled(availableKinds.count == 1)

            KlinaraDivider()

            KlinaraToggleRow(
                label: "Müşteriye görünür",
                detail: "Online müşteri sayfası açıldığında (Faz 9) gösterilecek.",
                isOn: $customerVisible,
                isEnabled: true
            )
        }
    }

    private func historySection(_ note: CustomerNote) -> some View {
        KlinaraFormSection(title: "Geçmiş") {
            KlinaraRow(
                label: note.wasEdited ? "Düzenlendi" : "Hiç düzenlenmedi",
                value: "Sürüm \(note.version)"
            )

            if note.wasEdited {
                KlinaraDivider()
                Button {
                    showsRevisions = true
                } label: {
                    KlinaraRow(label: "Düzenleme geçmişini gör") {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(KlinaraColor.charcoalMuted)
                    }
                }
                .buttonStyle(.plain)
            }

            KlinaraDivider()

            KlinaraButton(title: "Notu sil", kind: .tertiary, icon: "trash") {
                deleting = true
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private func save() async {
        error = nil
        do {
            if let existing {
                try await record.updateNote(id: existing.id, UpdateNoteInput(
                    body: trimmed,
                    kind: kind,
                    customerVisible: customerVisible
                ))
            } else {
                try await record.createNote(CreateNoteInput(
                    body: trimmed,
                    kind: kind,
                    appointmentId: appointmentId,
                    customerVisible: customerVisible
                ))
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }

    private func delete() async {
        guard let existing else { return }
        error = nil
        do {
            try await record.deleteNote(id: existing.id)
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
