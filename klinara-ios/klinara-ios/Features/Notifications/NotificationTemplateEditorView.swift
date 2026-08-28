import SwiftUI

/// Bir (olay, kanal, dil) şablonunun metnini düzenler.
///
/// Üç şeyi bilinçli olarak **yapmıyor**:
///
/// - Olay ve kanalı değiştirtmiyor: ikisi `locale` ile birlikte upsert
///   anahtarı. Değiştirilebilir olsalardı kullanıcı "bu şablonu düzenledim"
///   sanırken bambaşka bir satır açardı.
/// - Yer tutucuyu imleç konumuna eklemiyor, metnin sonuna ekliyor: SwiftUI'da
///   `TextEditor` seçimini güvenilir okumak mümkün değil ve yanlış yere
///   eklemek, hiç eklememekten kötü.
/// - WhatsApp'ta gövdeyi gönderimin metni gibi sunmuyor: Meta'ya giden metin
///   onaylı template'tir, buradaki gövde kaydın kendi kopyasıdır (Ek M).
struct NotificationTemplateEditorView: View {

    let session: AppSession
    let store: NotificationSettingsStore
    let template: NotificationTemplate

    @State private var form: NotificationTemplateForm?
    @State private var error: APIError?
    @Environment(\.dismiss) private var dismiss

    private var canWrite: Bool { session.can(Permissions.notificationManage) }

    var body: some View {
        Group {
            if let form {
                KlinaraFormScaffold(
                    title: template.event.turkishName,
                    canSave: form.isValid,
                    isDirty: form.isDirty,
                    isReadOnly: !canWrite,
                    isSaving: store.isSaving,
                    error: error,
                    onSave: { await submit(form) }
                ) {
                    scopeSection
                    bodySection(form)
                    if form.usesWhatsAppTemplate {
                        whatsappSection(form)
                    }
                    stateSection(form)
                }
            } else {
                ProgressView().tint(KlinaraColor.sage)
            }
        }
        .task {
            guard form == nil else { return }
            form = NotificationTemplateForm(editing: template)
        }
    }

    /// Anahtar alanlar salt okunur satır olarak gösteriliyor, gizlenmiyor:
    /// kullanıcının hangi şablonu düzenlediğini görmesi gerekir.
    private var scopeSection: some View {
        KlinaraFormSection(title: "Kapsam") {
            KlinaraRow(label: "Olay", value: template.event.turkishName)
            KlinaraDivider()
            KlinaraRow(label: "Kanal", value: template.channel.turkishName)
            KlinaraDivider()
            KlinaraRow(
                label: "Tür",
                value: template.kind.turkishName,
                detail: template.kind.explanation
            )
            if template.isDefault {
                KlinaraDivider()
                note("Şu anda kod içindeki varsayılan metin geçerli. Kaydettiğinizde bu kiracıya özel bir şablon oluşur.")
            }
            if !template.channel.isDeliverable {
                KlinaraDivider()
                note("Bu kanalın sağlayıcısı henüz kurulmadı; şablon kaydedilir ama mesaj gönderilmez.")
            }
        }
    }

    private func bodySection(_ form: NotificationTemplateForm) -> some View {
        KlinaraFormSection(
            title: "Metin",
            footnote: "Değişkenler gönderim anında müşteri ve randevu bilgisiyle doldurulur."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                if form.usesSubject {
                    KlinaraTextField(
                        label: "Konu",
                        text: Binding(get: { form.subject }, set: { form.subject = $0 }),
                        placeholder: "E-posta konusu",
                        error: error?.fieldErrors["subject"],
                        autocapitalization: .sentences
                    )
                }

                KlinaraTextEditor(
                    label: "Gövde",
                    text: Binding(get: { form.body }, set: { form.body = $0 }),
                    placeholder: "Sayın {{customerName}}, …",
                    error: error?.fieldErrors["body"],
                    minHeight: 140
                )

                Text("Kullanılabilecek değişkenler")
                    .klinaraText(.label)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)

                KlinaraChipGrid(
                    options: form.allowedVariables.map(VariableOption.init),
                    title: { "{{\($0.name)}}" },
                    isSelected: { form.body.contains("{{\($0.name)}}") },
                    isEnabled: { _ in canWrite },
                    onTap: { form.appendVariable($0.name) }
                )

                // Sunucudan 422 beklemek yerine burada söylüyoruz: kullanıcı
                // hatayı kaydete basınca değil, yazarken görmeli.
                if !form.unknownPlaceholders.isEmpty {
                    Text("Tanımsız değişken: \(form.unknownPlaceholders.joined(separator: ", "))")
                        .klinaraText(.bodyM)
                        .font(.footnote)
                        .foregroundStyle(KlinaraColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private func whatsappSection(_ form: NotificationTemplateForm) -> some View {
        KlinaraFormSection(
            title: "WhatsApp şablonu",
            footnote: "WhatsApp'a giden metin Meta'da onaylı template'tir. Buradaki eşleme, template'in {{1}}, {{2}}… sırasına hangi değişkenin gideceğini söyler."
        ) {
            VStack(alignment: .leading, spacing: KlinaraMetrics.md) {
                KlinaraTextField(
                    label: "Meta şablon adı",
                    text: Binding(get: { form.whatsappTemplateName }, set: { form.whatsappTemplateName = $0 }),
                    placeholder: "randevu_hatirlatma",
                    error: error?.fieldErrors["whatsappTemplateName"]
                )
                KlinaraTextField(
                    label: "Şablon dili",
                    text: Binding(
                        get: { form.whatsappTemplateLanguage },
                        set: { form.whatsappTemplateLanguage = $0 }
                    ),
                    placeholder: "tr",
                    error: error?.fieldErrors["whatsappTemplateLanguage"]
                )

                Text("Konumsal değişkenler")
                    .klinaraText(.label)
                    .foregroundStyle(KlinaraColor.charcoalMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if form.whatsappVariables.isEmpty {
                    Text("Henüz eşleme yok. Aşağıdan sırayla ekleyin.")
                        .klinaraText(.bodyM)
                        .foregroundStyle(KlinaraColor.charcoalMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(Array(form.whatsappVariables.enumerated()), id: \.offset) { index, name in
                        HStack(spacing: KlinaraMetrics.sm) {
                            Text("{{\(index + 1)}}")
                                .klinaraText(.code)
                                .foregroundStyle(KlinaraColor.charcoalMuted)
                            Text(name)
                                .klinaraText(.bodyM)
                                .foregroundStyle(KlinaraColor.charcoal)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if canWrite {
                                Button {
                                    form.removeWhatsAppVariable(at: index)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(KlinaraColor.charcoalMuted)
                                }
                                .accessibilityLabel("\(index + 1). değişkeni kaldır")
                            }
                        }
                    }
                }

                if canWrite {
                    KlinaraChipGrid(
                        options: form.allowedVariables
                            .filter { !form.whatsappVariables.contains($0) }
                            .map(VariableOption.init),
                        title: \.name,
                        isSelected: { _ in false },
                        onTap: { form.addWhatsAppVariable($0.name) }
                    )
                }
            }
            .padding(KlinaraMetrics.md)
        }
    }

    private func stateSection(_ form: NotificationTemplateForm) -> some View {
        KlinaraFormSection(title: "Durum") {
            KlinaraToggleRow(
                label: "Aktif",
                detail: "Pasif şablonla bu olay için mesaj üretilmez.",
                isOn: Binding(get: { form.isActive }, set: { form.isActive = $0 }),
                isEnabled: canWrite
            )
        }
    }

    /// Kart içindeki açıklama satırı. ``KlinaraCard`` içeriğine yatay boşluk
    /// eklemiyor; satır dolgusunu kendisi taşımalı (``KlinaraRow`` ile aynı `md`).
    private func note(_ text: String) -> some View {
        Text(text)
            .klinaraText(.bodyM)
            .foregroundStyle(KlinaraColor.charcoalMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(KlinaraMetrics.md)
    }

    private func submit(_ form: NotificationTemplateForm) async {
        error = nil
        do {
            _ = try await store.upsertTemplate(form.input())
            dismiss()
        } catch {
            self.error = error as? APIError ?? .network
        }
    }
}

/// ``KlinaraChipGrid`` `Identifiable` istiyor; `String` değil.
private struct VariableOption: Hashable, Identifiable {
    let name: String
    var id: String { name }
}
