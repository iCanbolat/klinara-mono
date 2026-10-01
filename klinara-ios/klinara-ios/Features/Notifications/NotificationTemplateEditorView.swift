import SwiftUI

/// Bildirim şablonu detayı — müşterinin gördüğü sade görünüm.
///
/// Müşteri yalnız mesajın **gönderilip gönderilmeyeceğini** seçer. Mesaj metni
/// salt okunur: WhatsApp'a giden metin Meta'da onaylı template'tir, buradaki
/// gövde kaydın kopyasıdır (Ek M), düzenlenebilir görünmesi gönderimi
/// değiştirdiği izlenimini verirdi. Meta şablon adı, dil ve değişken eşlemesi
/// teknik ayrıntıdır; ekranda yer almaz ve değiştirilemez (kayıt onları olduğu
/// gibi geri gönderir).
struct NotificationTemplateEditorView: View {

    let session: AppSession
    let store: NotificationSettingsStore
    let template: NotificationTemplate

    @State private var form: NotificationTemplateForm?
    @State private var error: APIError?
    /// Klinik konumu: seçili şubenin adresi. Mesajlara `branchAddress` olarak girer;
    /// "Haritada aç" butonu bu adresten üretilir. Şube kaydında durur.
    @State private var branch: BranchDetail?
    @Environment(\.dismiss) private var dismiss

    private var canWrite: Bool { session.can(Permissions.notificationManage) }

    var body: some View {
        Group {
            if let form {
                KlinaraFormScaffold(
                    title: template.event.turkishName,
                    canSave: form.isDirty,
                    isDirty: form.isDirty,
                    isReadOnly: !canWrite,
                    isSaving: store.isSaving,
                    error: error,
                    onSave: { await submit(form) }
                ) {
                    messageSection(form)
                    locationSection
                    stateSection(form)
                }
            } else {
                KlinaraSkeletonView(style: .formLong)
            }
        }
        .task {
            guard form == nil else { return }
            form = NotificationTemplateForm(editing: template)
            await loadBranch()
        }
    }

    private func messageSection(_ form: NotificationTemplateForm) -> some View {
        KlinaraFormSection(
            title: "Müşteriye giden mesaj",
            footnote: "Mavi @ ile başlayan bilgiler gönderim anında müşteriye özel doldurulur."
        ) {
            Text(form.segments.isEmpty ? AttributedString("(metin yok)") : form.segments.attributed())
                .klinaraText(.bodyM)
                .foregroundStyle(KlinaraColor.charcoal)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KlinaraMetrics.md)
        }
    }

    @ViewBuilder
    private var locationSection: some View {
        if let branch {
            KlinaraFormSection(
                title: "Klinik konumu",
                footnote: "Adres, randevu mesajlarında müşteriye gösterilir; mesajdaki \"Haritada aç\" butonu bu adresten oluşturulur. Adresi şube ayarlarından değiştirebilirsiniz. Şube: \(branch.name)."
            ) {
                KlinaraRow(
                    label: "Adres",
                    value: (branch.address ?? "").isEmpty ? "Girilmemiş" : (branch.address ?? "")
                )
            }
        }
    }

    private func loadBranch() async {
        guard let id = session.selectedBranch?.id,
              let detail = try? await session.services.branches.branches().first(where: { $0.id == id })
        else { return }
        branch = detail
    }

    private func stateSection(_ form: NotificationTemplateForm) -> some View {
        KlinaraFormSection(title: "Gönderim") {
            KlinaraToggleRow(
                label: "Bu mesaj gönderilsin",
                detail: "Kapalıyken müşteriye bu mesaj gitmez.",
                isOn: Binding(get: { form.isActive }, set: { form.isActive = $0 }),
                isEnabled: canWrite
            )
        }
    }

    private func submit(_ form: NotificationTemplateForm) async {
        error = nil
        do {
            if form.isDirty {
                _ = try await store.upsertTemplate(form.input())
            }
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
