import Foundation

/// Şablon detayının durumu.
///
/// Müşteri yalnız ``isActive``'i değiştirir. Metin, Meta şablon adı/dili ve
/// konumsal eşleme **sabit**: WhatsApp'a giden mesaj Meta'da onaylı template'tir,
/// buradaki gövde yalnız kaydın kopyasıdır; düzenlenebilir görünmesi gönderimi
/// değiştirdiği izlenimini verirdi. Kayıt, mevcut değerleri olduğu gibi geri
/// gönderir.
@MainActor
@Observable
final class NotificationTemplateForm {

    /// `(event, channel, locale)` birleşik anahtar olduğu için değiştirilemez.
    let event: NotificationEvent
    let channel: NotificationChannel
    let locale: String

    let subject: String
    let body: String
    var isActive: Bool
    let whatsappTemplateName: String
    let whatsappTemplateLanguage: String
    /// Meta'nın `{{1}}, {{2}}…` sırasına karşılık gelen adlar. **Sıra anlamlı.**
    let whatsappVariables: [String]

    /// Kiracının kendi satırı var mıydı — ilk kayıtta yeni satır açılır.
    let wasDefault: Bool

    private let originalIsActive: Bool

    init(editing template: NotificationTemplate) {
        event = template.event
        channel = template.channel
        locale = template.locale
        subject = template.subject ?? ""
        body = template.body
        segments = template.segments
        isActive = template.isActive
        whatsappTemplateName = template.whatsappTemplateName ?? ""
        whatsappTemplateLanguage = template.whatsappTemplateLanguage ?? "tr"
        whatsappVariables = template.whatsappVariables
        wasDefault = template.isDefault
        originalIsActive = template.isActive
    }

    /// Konu yalnız e-posta kanalında; sunucu diğerlerinde 422 veriyor.
    var usesSubject: Bool { channel == .email }

    var usesWhatsAppTemplate: Bool { channel == .whatsapp }

    /// Müşteriye giden mesaj: değişkenler mavi `@Etiket` olarak.
    let segments: [TemplateSegment]

    var isDirty: Bool { isActive != originalIsActive }

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
