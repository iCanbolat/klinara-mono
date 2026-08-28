import SwiftUI

/// Bağlantıyı gerçek bir gönderimle sınar.
///
/// Şablon listesi **değişkensiz onaylı** template'lerle sınırlı: sunucu test
/// isteğini `parameters: []` ile yolluyor, dolayısıyla değişken bekleyen bir
/// şablon Meta tarafından reddedilir. Hepsini listeleyip kullanıcıyı
/// başarısız bir gönderime sürüklemek yerine sebebi önden söylüyoruz.
struct WhatsAppTestSheet: View {

    let store: WhatsAppStore

    @State private var phone = ""
    @State private var selectedTemplate: String?
    @State private var error: APIError?
    @State private var result: SendTestMessageResult?
    @Environment(\.dismiss) private var dismiss

    private var isValid: Bool { !phone.isEmpty && selectedTemplate != nil }

    var body: some View {
        KlinaraFormScaffold(
            title: "Test mesajı",
            saveTitle: "Gönder",
            canSave: isValid,
            isDirty: !phone.isEmpty || selectedTemplate != nil,
            isSaving: store.isSaving,
            error: error,
            onSave: { await send() }
        ) {
            recipientSection
            templateSection
            if let result {
                resultSection(result)
            }
        }
    }

    private var recipientSection: some View {
        KlinaraFormSection(
            title: "Alıcı",
            footnote: "Numaranın WhatsApp'ta kayıtlı olması gerekir. Test gönderimi mesaj günlüğüne de yazılır."
        ) {
            PhoneNumberField(
                label: "Telefon",
                e164: $phone,
                error: error?.fieldErrors["to"]
            )
            // ``KlinaraCard`` içeriğine yatay boşluk EKLEMEZ; serbest içerik
            // dolgusunu kendisi taşır (``KlinaraRow`` ile aynı `md`).
            .padding(KlinaraMetrics.md)
        }
    }

    @ViewBuilder
    private var templateSection: some View {
        let options = store.testableTemplates
        KlinaraFormSection(
            title: "Şablon",
            footnote: "Test gönderimi parametresiz yapılır; yalnız değişken beklemeyen onaylı şablonlar seçilebilir."
        ) {
            if options.isEmpty {
                Text(store.templates.isEmpty
                    ? "Henüz senkronlanmış şablon yok. Önce bağlantıyı doğrulayın."
                    : "Değişken beklemeyen onaylı bir şablon yok. Meta'da parametresiz bir test şablonu oluşturun.")
                    .klinaraText(.bodyM)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(KlinaraMetrics.md)
            } else {
                ForEach(Array(options.enumerated()), id: \.element.rowId) { index, template in
                    if index > 0 { KlinaraDivider() }
                    Button {
                        selectedTemplate = template.name
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(template.name)
                                    .klinaraText(.bodyM)
                                    .foregroundStyle(KlinaraColor.charcoal)
                                Text(template.language.uppercased())
                                    .klinaraText(.bodyM)
                                    .font(.footnote)
                                    .foregroundStyle(KlinaraColor.charcoalMuted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)

                            if selectedTemplate == template.name {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(KlinaraColor.sageDeep)
                            }
                        }
                        .padding(KlinaraMetrics.md)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func resultSection(_ result: SendTestMessageResult) -> some View {
        KlinaraFormSection(title: "Sonuç") {
            KlinaraRow(
                label: "Durum",
                value: result.accepted ? "Sağlayıcı kabul etti" : "Kabul edilmedi",
                // Kabul edilmek ULAŞMAK değil: teslim durumu webhook'la
                // sonradan geliyor ve mesaj günlüğünde görünür.
                detail: "Kabul, teslim demek değildir. Teslim durumu mesaj günlüğünde güncellenir."
            )
            if let id = result.providerMessageId {
                KlinaraDivider()
                KlinaraRow(label: "Sağlayıcı mesaj kimliği", value: id, isMonospaced: true)
            }
        }
    }

    private func send() async {
        guard let templateName = selectedTemplate else { return }
        error = nil
        result = nil
        do {
            result = try await store.sendTest(SendTestMessageInput(
                to: phone,
                templateName: templateName,
                templateLanguage: store.testableTemplates
                    .first { $0.name == templateName }?.language
            ))
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}
