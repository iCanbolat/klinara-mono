import Foundation

/// Şablon düzenleme formunun durumu.
///
/// Yer tutucu doğrulaması **burada** yapılıyor, sunucudan gelen 422'yi
/// beklemeden: kullanıcı `{{musteriAdi}}` yazıp kaydete bastığında hatayı
/// öğrenmek yerine, yazarken görmeli. Sunucu yine son söz sahibi
/// (``APIErrorCode/templateInvalid``); buradaki kontrol bir kolaylık.
@MainActor
@Observable
final class NotificationTemplateForm {

    /// `(event, channel, locale)` birleşik anahtar olduğu için düzenlemede
    /// **değiştirilemez** — değiştirilirse aynı satır güncellenmez, yenisi açılır.
    let event: NotificationEvent
    let channel: NotificationChannel
    let locale: String

    var subject: String
    var body: String
    var isActive: Bool
    var whatsappTemplateName: String
    var whatsappTemplateLanguage: String
    /// Meta'nın `{{1}}, {{2}}…` sırasına karşılık gelen adlar. **Sıra anlamlı.**
    var whatsappVariables: [String]

    /// Kiracının kendi satırı var mıydı — "Varsayılan" rozetini ve kaydetme
    /// metnini belirler.
    let wasDefault: Bool

    private let originalSubject: String
    private let originalBody: String
    private let originalIsActive: Bool
    private let originalTemplateName: String
    private let originalTemplateLanguage: String
    private let originalVariables: [String]

    init(editing template: NotificationTemplate) {
        event = template.event
        channel = template.channel
        locale = template.locale
        subject = template.subject ?? ""
        body = template.body
        isActive = template.isActive
        whatsappTemplateName = template.whatsappTemplateName ?? ""
        whatsappTemplateLanguage = template.whatsappTemplateLanguage ?? "tr"
        whatsappVariables = template.whatsappVariables
        wasDefault = template.isDefault

        // `@Observable` sarmalayıcıları yüzünden kendi alanlarını okumadan
        // önce hepsinin atanmış olması gerekiyor; kaynak yine `template`.
        originalSubject = template.subject ?? ""
        originalBody = template.body
        originalIsActive = template.isActive
        originalTemplateName = template.whatsappTemplateName ?? ""
        originalTemplateLanguage = template.whatsappTemplateLanguage ?? "tr"
        originalVariables = template.whatsappVariables
    }

    // MARK: Değişkenler

    /// Bu olayda kullanılabilecek adlar.
    var allowedVariables: [String] { NotificationEventCatalog.variables(for: event) }

    /// Gövdede (ve e-postada konuda) geçen ama tanımlı olmayan adlar.
    var unknownPlaceholders: [String] {
        var unknown = NotificationEventCatalog.unknownPlaceholders(in: body, event: event)
        if usesSubject {
            unknown += NotificationEventCatalog.unknownPlaceholders(in: subject, event: event)
        }
        // WhatsApp konumsal değişkenleri de aynı beyaz listeye tabi.
        let allowed = Set(allowedVariables)
        unknown += whatsappVariables.filter { !allowed.contains($0) }
        return Array(Set(unknown)).sorted()
    }

    /// Konu yalnız e-posta kanalında; sunucu diğerlerinde 422 veriyor.
    var usesSubject: Bool { channel == .email }

    var usesWhatsAppTemplate: Bool { channel == .whatsapp }

    /// Metni imleç yerine değil sonuna ekliyoruz: `TextEditor`ın seçim
    /// konumunu SwiftUI'dan güvenilir biçimde okumak mümkün değil ve yanlış
    /// yere eklemek, doğru yere eklememekten kötü.
    func appendVariable(_ name: String) {
        body += "{{\(name)}}"
    }

    /// Sıralama ayrı bir "taşı" jesti olarak sunulmuyor: listeden çıkarıp
    /// yeniden eklemek sırayı zaten belirliyor ve üç öğelik bir listede
    /// sürükle-bırak, kazandırdığından fazlasını karmaşıklaştırırdı.
    func addWhatsAppVariable(_ name: String) {
        guard !whatsappVariables.contains(name) else { return }
        whatsappVariables.append(name)
    }

    func removeWhatsAppVariable(at index: Int) {
        guard whatsappVariables.indices.contains(index) else { return }
        whatsappVariables.remove(at: index)
    }

    // MARK: Durum

    var isDirty: Bool {
        subject != originalSubject
            || body != originalBody
            || isActive != originalIsActive
            || whatsappTemplateName != originalTemplateName
            || whatsappTemplateLanguage != originalTemplateLanguage
            || whatsappVariables != originalVariables
    }

    var isValid: Bool {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 4000 else { return false }
        guard unknownPlaceholders.isEmpty else { return false }
        if usesWhatsAppTemplate, !whatsappTemplateName.isEmpty {
            // Template adı verildiyse dili de verilmeli: Meta ikisini birlikte
            // istiyor ve eksik dil, gönderim anında çözülemez bir hata olurdu.
            return !whatsappTemplateLanguage.isEmpty
        }
        return true
    }

    func input() -> UpsertNotificationTemplateInput {
        UpsertNotificationTemplateInput(
            event: event,
            channel: channel,
            locale: locale,
            subject: usesSubject && !subject.isEmpty ? subject : nil,
            body: body,
            whatsappTemplateName: usesWhatsAppTemplate && !whatsappTemplateName.isEmpty
                ? whatsappTemplateName
                : nil,
            whatsappTemplateLanguage: usesWhatsAppTemplate && !whatsappTemplateName.isEmpty
                ? whatsappTemplateLanguage
                : nil,
            whatsappVariables: usesWhatsAppTemplate ? whatsappVariables : nil,
            isActive: isActive
        )
    }
}
