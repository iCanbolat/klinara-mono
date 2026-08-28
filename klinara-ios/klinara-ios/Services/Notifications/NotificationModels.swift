import Foundation

// Kaynak: `apps/api/src/modules/notifications/dto/notification.dto.ts` ve
// `apps/api/src/modules/notifications/default-templates.ts`.
//
// Faz 8'in tek giriş noktası kararı (Ek M) istemciyi de biçimlendiriyor: ekranlar
// "şu olay, şu kanal, şu metin" der; opt-out, sessiz saat ve kanal seçimi
// sunucudaki `NotificationDispatcherService`te uygulanır. Burada yalnız o
// ayarların **yönetimi** modellenir, gönderim mantığı değil.

// MARK: - Enum'lar

/// Bildirim olayı.
///
/// **Açık** küme: sunucu yeni bir olay tanımladığında (doğum günü süpürücüsü,
/// paket bakiyesi…) eski bir istemci mesaj günlüğünü çözemeyip patlamamalı.
/// ``CommissionScope`` gibi form içinde seçilen kapalı kümelerden farkı bu:
/// olay listesi sunucudan gelen bir veriyi **okur**, kullanıcı onu üretmez.
nonisolated enum NotificationEvent: String, Codable, Sendable, CaseIterable, Identifiable {
    case appointmentConfirmation = "appointment_confirmation"
    case appointmentReminder = "appointment_reminder"
    case appointmentCancelled = "appointment_cancelled"
    case noShowFollowup = "no_show_followup"
    case packageBalance = "package_balance"
    case packageExpiring = "package_expiring"
    case birthday
    case autoReply = "auto_reply"
    case staffInternal = "staff_internal"
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NotificationEvent(rawValue: raw) ?? .unknown
    }

    var id: String { rawValue }

    /// Seçim listelerinde `unknown` gösterilmez — kullanıcı onu üretemez.
    static var selectable: [NotificationEvent] { allCases.filter { $0 != .unknown } }

    var turkishName: String {
        switch self {
        case .appointmentConfirmation: return "Randevu onayı"
        case .appointmentReminder: return "Randevu hatırlatması"
        case .appointmentCancelled: return "Randevu iptali"
        case .noShowFollowup: return "Gelmedi takibi"
        case .packageBalance: return "Paket bakiyesi"
        case .packageExpiring: return "Paket süre dolumu"
        case .birthday: return "Doğum günü"
        case .autoReply: return "Otomatik yanıt"
        case .staffInternal: return "Personel bildirimi"
        case .unknown: return "Bilinmeyen olay"
        }
    }

    var explanation: String {
        switch self {
        case .appointmentConfirmation: return "Randevu oluşturulduğunda müşteriye gider."
        case .appointmentReminder: return "Randevudan önce, hatırlatma ayarındaki saatlerde gider."
        case .appointmentCancelled: return "Randevu iptal edildiğinde müşteriye gider."
        case .noShowFollowup: return "Müşteri gelmediğinde, ayarlanan gecikmeden sonra gider."
        case .packageBalance: return "Paket hakkı azaldığında müşteriye gider."
        case .packageExpiring: return "Paketin süresi dolmadan önce müşteriye gider."
        case .birthday: return "Doğum gününde gider. Tek pazarlama olayı: iletişim izni iptalinden etkilenir."
        case .autoReply: return "Müşterinin WhatsApp yanıtına verilen otomatik karşılık."
        case .staffInternal: return "Müşteriye değil, personele giden iç bildirim."
        case .unknown: return "Bu sürümde tanınmayan bir olay. Uygulamayı güncelleyin."
        }
    }
}

/// Gönderim kanalı — **kapalı** küme: kullanıcı bunu formdan seçiyor ve sunucu
/// gövde doğrulamasında `IsIn(ALL_CHANNELS)` ile sınırlıyor.
nonisolated enum NotificationChannel: String, Codable, Sendable, CaseIterable, Identifiable {
    case whatsapp
    case sms
    case email
    case push

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .whatsapp: return "WhatsApp"
        case .sms: return "SMS"
        case .email: return "E-posta"
        case .push: return "Uygulama bildirimi"
        }
    }

    var icon: String {
        switch self {
        case .whatsapp: return "bubble.left.and.bubble.right"
        case .sms: return "message"
        case .email: return "envelope"
        case .push: return "iphone.gen3.radiowaves.left.and.right"
        }
    }

    /// MVP'de yalnız WhatsApp ve e-posta gerçekten gönderim yapıyor; SMS ve push
    /// kanal soyutlamasında var ama sağlayıcısı yok (Ek M). Ekran bunu söylemeli,
    /// yoksa kullanıcı kanalı açıp mesajın neden gitmediğini arar.
    var isDeliverable: Bool { self == .whatsapp || self == .email }
}

/// İşlemsel / pazarlama ayrımı.
///
/// Ek M kararı: ayrım **olayın tanımında**, kiracı ayarında değil. Randevu
/// hatırlatması ticari ileti değildir ve iletişim izni iptalinden etkilenmez.
nonisolated enum NotificationKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case transactional
    case marketing

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .transactional: return "İşlemsel"
        case .marketing: return "Pazarlama"
        }
    }

    var explanation: String {
        switch self {
        case .transactional: return "Müşterinin kendi işlemiyle ilgili; iletişim izni iptalinden etkilenmez."
        case .marketing: return "Ticari ileti; iletişim izni iptal edilmişse gönderilmez."
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .transactional: return .neutral
        case .marketing: return .warning
        }
    }
}

/// İletişim izni iptalinin kaynağı.
nonisolated enum OptOutSource: String, Codable, Sendable, CaseIterable, Identifiable {
    case customerRequest = "customer_request"
    case inboundStop = "inbound_stop"
    case staff

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .customerRequest: return "Müşteri talebi"
        case .inboundStop: return "Gelen \"DUR\" mesajı"
        case .staff: return "Personel kaydı"
        }
    }
}

// MARK: - Olay kataloğu

/// Olay → izinli değişken adları tablosu; `default-templates.ts`in aynası.
///
/// İstemcide durmasının sebebi tek bir kullanıcı deneyimi kararı: şablon
/// editörü `{{…}}` yer tutucularını **yazarken** doğrulayabilsin. Aksi halde
/// kullanıcı geçersiz bir değişkeni ancak kaydete basıp 422 `TEMPLATE_INVALID`
/// yiyerek öğrenirdi. Sunucu yine son söz sahibi — bu tablo bir kolaylık,
/// bir yetki değil.
nonisolated enum NotificationEventCatalog {

    nonisolated struct Definition: Sendable, Equatable {
        let kind: NotificationKind
        /// Varsayılan kanal önceliği.
        let channels: [NotificationChannel]
        /// Şablon gövdesinde ve `whatsappVariables` içinde kullanılabilecek adlar.
        let variables: [String]
    }

    static let definitions: [NotificationEvent: Definition] = [
        .appointmentConfirmation: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms, .email],
            variables: ["customerName", "branchName", "appointmentAt", "serviceName"]
        ),
        .appointmentReminder: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms, .email],
            variables: ["customerName", "branchName", "appointmentAt", "serviceName"]
        ),
        .appointmentCancelled: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms, .email],
            variables: ["customerName", "branchName", "appointmentAt"]
        ),
        .noShowFollowup: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms],
            variables: ["customerName", "branchName"]
        ),
        .packageBalance: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms, .email],
            variables: ["customerName", "packageName", "remainingSessions"]
        ),
        .packageExpiring: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms, .email],
            variables: ["customerName", "packageName", "expiresAt", "remainingSessions"]
        ),
        .birthday: Definition(
            kind: .marketing,
            channels: [.whatsapp, .sms],
            variables: ["customerName", "branchName"]
        ),
        .autoReply: Definition(
            kind: .transactional,
            channels: [.whatsapp, .sms],
            variables: ["message"]
        ),
        .staffInternal: Definition(
            kind: .transactional,
            channels: [.email],
            variables: ["subject", "message"]
        ),
    ]

    static func variables(for event: NotificationEvent) -> [String] {
        definitions[event]?.variables ?? []
    }

    static func kind(for event: NotificationEvent) -> NotificationKind {
        definitions[event]?.kind ?? .transactional
    }

    /// Metindeki `{{ad}}` yer tutucuları, göründükleri sırada ve tekrarsız.
    static func placeholders(in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: "\\{\\{\\s*([A-Za-z0-9_]+)\\s*\\}\\}") else {
            return []
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        var found: [String] = []
        for match in regex.matches(in: text, range: range) {
            guard let nameRange = Range(match.range(at: 1), in: text) else { continue }
            let name = String(text[nameRange])
            if !found.contains(name) { found.append(name) }
        }
        return found
    }

    /// Metinde geçen ama bu olayda tanımlı olmayan değişkenler.
    /// Boş dönmesi sunucunun `TEMPLATE_INVALID` vermeyeceği anlamına gelir.
    static func unknownPlaceholders(in text: String, event: NotificationEvent) -> [String] {
        let allowed = Set(variables(for: event))
        return placeholders(in: text).filter { !allowed.contains($0) }
    }
}

// MARK: - Şablonlar

/// `NotificationTemplateResponseDto`.
///
/// Liste **birleştirilmiş etkin görünüm**tür: kiracı satırı olmayan her
/// (olay, kanal) çifti için kod içindeki varsayılan `isDefault: true` ile döner
/// ve `id` `nil` olur. Ekran bu yüzden "sil" değil "varsayılana dön" sunar.
nonisolated struct NotificationTemplate: Decodable, Sendable, Identifiable, Equatable {
    /// Kiracı satırı yoksa `nil` — kod varsayılanı geçerli.
    ///
    /// Adı sunucudaki gibi `id` DEĞİL: `Identifiable`ın `id`'si bu olamaz —
    /// varsayılan satırlarda `nil` ve iki farklı varsayılanı `ForEach` aynı
    /// görürdü. Kimlik ``rowId`` bileşik anahtarından geliyor.
    let templateId: String?
    let event: NotificationEvent
    let channel: NotificationChannel
    let locale: String
    let kind: NotificationKind
    /// Yalnız e-posta kanalında anlamlı; sunucu diğer kanallarda 422 veriyor.
    let subject: String?
    let body: String
    /// Meta'da onaylı template adı. Ek M: WhatsApp metni bizden gitmiyor,
    /// template adı ve KONUMSAL parametreler gerekiyor.
    let whatsappTemplateName: String?
    let whatsappTemplateLanguage: String?
    /// `{{1}}, {{2}}…` sırasına karşılık gelen değişken adları. **Sıra anlamlıdır.**
    let whatsappVariables: [String]
    let isActive: Bool
    let isDefault: Bool
    /// Sunucunun gövdeden ayrıştırdığı yer tutucular.
    let variables: [String]

    /// `(event, channel, locale)` bileşik anahtarı — sunucudaki upsert anahtarı.
    var rowId: String { "\(event.rawValue)|\(channel.rawValue)|\(locale)" }

    var id: String { rowId }

    private enum CodingKeys: String, CodingKey {
        case templateId = "id"
        case event, channel, locale, kind, subject, body
        case whatsappTemplateName, whatsappTemplateLanguage, whatsappVariables
        case isActive, isDefault, variables
    }
}

nonisolated struct UpsertNotificationTemplateInput: Encodable, Sendable, Equatable {
    let event: NotificationEvent
    let channel: NotificationChannel
    var locale: String?
    var subject: String?
    let body: String
    var whatsappTemplateName: String?
    var whatsappTemplateLanguage: String?
    var whatsappVariables: [String]?
    var isActive: Bool?
}

// MARK: - Tercihler

/// `NotificationPreferenceResponseDto`.
///
/// `branchId == nil` kiracı varsayılanıdır; şube satırı onu ezer. Sunucu
/// bileşik bir kimlik döndürmüyor ve varsayılan satırların `id`'si `nil`, bu
/// yüzden liste `(event, branchId)` ile anahtarlanır.
nonisolated struct NotificationPreference: Decodable, Sendable, Identifiable, Equatable {
    /// ``NotificationTemplate/templateId`` ile aynı gerekçeyle `id` değil.
    let preferenceId: String?
    /// `nil` = kiracı varsayılanı.
    let branchId: String?
    let event: NotificationEvent
    let kind: NotificationKind
    /// Öncelik sırasında denenecek kanallar. **Boş dizi = olay kapalı.**
    let channels: [NotificationChannel]
    /// `"HH:MM"`. Ek M: pencere gece yarısını aşar (21:00–09:00) ve şube saat
    /// diliminde yorumlanır.
    let quietHoursStart: String?
    let quietHoursEnd: String?
    let isDefault: Bool

    /// `(event, branchId)` — sunucu bileşik bir kimlik döndürmüyor.
    var rowId: String { "\(event.rawValue)|\(branchId ?? "tenant")" }

    var id: String { rowId }

    var isEnabled: Bool { !channels.isEmpty }

    var quietHoursLabel: String? {
        guard let start = quietHoursStart, let end = quietHoursEnd else { return nil }
        return "\(start) – \(end)"
    }

    private enum CodingKeys: String, CodingKey {
        case preferenceId = "id"
        case branchId, event, kind, channels, quietHoursStart, quietHoursEnd, isDefault
    }
}

nonisolated struct UpsertNotificationPreferenceInput: Encodable, Sendable, Equatable {
    /// Verilmezse kiracı varsayılanı yazılır.
    var branchId: String?
    let event: NotificationEvent
    let channels: [NotificationChannel]
    /// Sunucu ikisinden **yalnız biri** verilirse `VALIDATION_FAILED` döner;
    /// form ikisini birlikte üretir.
    var quietHoursStart: String?
    var quietHoursEnd: String?
}

// MARK: - İletişim izni

/// `OptOutResponseDto`. `channel == nil` tüm kanalları kapsar.
nonisolated struct OptOutRecord: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let customerId: String
    let channel: NotificationChannel?
    let kind: NotificationKind
    let source: OptOutSource
    let createdAt: Date

    var channelLabel: String { channel?.turkishName ?? "Tüm kanallar" }
}

nonisolated struct CreateOptOutInput: Encodable, Sendable, Equatable {
    /// Verilmezse TÜM kanallar kapatılır.
    var channel: NotificationChannel?
    var source: OptOutSource?
    var note: String?
}
