import Foundation

// Kaynak: `apps/api/src/modules/notifications/dto/notification.dto.ts` ve
// `apps/api/src/modules/notifications/default-templates.ts`.
//
// Faz 8'in tek giriş noktası kararı (Ek M) istemciyi de biçimlendiriyor: ekranlar
// "şu olay, şu kanal, şu metin" der; sessiz saat ve kanal seçimi
// sunucudaki `NotificationDispatcherService`te uygulanır. Burada yalnız o
// ayarların **yönetimi** modellenir, gönderim mantığı değil.

// MARK: - Enum'lar

/// Bildirim olayı.
///
/// **Açık** küme: sunucu yeni bir olay tanımladığında eski bir istemci mesaj
/// günlüğünü çözemeyip patlamamalı. Kaldırılmış olayların geçmiş satırları da
/// (ör. doğum günü) buraya düşer.
/// Form içinde seçilen kapalı kümelerden farkı bu:
/// olay listesi sunucudan gelen bir veriyi **okur**, kullanıcı onu üretmez.
nonisolated enum NotificationEvent: String, Codable, Sendable, CaseIterable, Identifiable {
    case appointmentConfirmation = "appointment_confirmation"
    case appointmentReminder = "appointment_reminder"
    case appointmentCancelled = "appointment_cancelled"
    case noShowFollowup = "no_show_followup"
    case packageBalance = "package_balance"
    case packageExpiring = "package_expiring"
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

    /// Şablon ekranında görünen olaylar: personel iç bildirimi dışarıda — metnini
    /// kiracı değil platform belirliyor (davet, parola sıfırlama e-postaları).
    /// Mesaj günlüğü süzgeci ise ``selectable``ı kullanır: geçmiş satırlar var.
    static var templateEvents: [NotificationEvent] { selectable.filter { $0 != .staffInternal } }

    var turkishName: String {
        switch self {
        case .appointmentConfirmation: return "Randevu onayı"
        case .appointmentReminder: return "Randevu hatırlatması"
        case .appointmentCancelled: return "Randevu iptali"
        case .noShowFollowup: return "Gelmedi takibi"
        case .packageBalance: return "Paket bakiyesi"
        case .packageExpiring: return "Paket süre dolumu"
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
        case .autoReply: return "Müşterinin WhatsApp yanıtına verilen otomatik karşılık."
        case .staffInternal: return "Müşteriye değil, personele giden iç bildirim."
        case .unknown: return "Bu sürümde tanınmayan bir olay. Uygulamayı güncelleyin."
        }
    }
}

/// Gönderim kanalı.
///
/// **Açık** küme: mesaj günlüğü geçmişte yazılmış, artık desteklenmeyen
/// kanalların (SMS) satırlarını taşıyabilir; onları çözemeyip listeyi
/// patlatmak yerine `unknown` olarak gösteriyoruz. Formda seçilebilenler
/// ``customerSelectable`` ve ``selectable``.
nonisolated enum NotificationChannel: String, Codable, Sendable, CaseIterable, Identifiable {
    case whatsapp
    case email
    case push
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = NotificationChannel(rawValue: raw) ?? .unknown
    }

    var id: String { rawValue }

    /// Süzgeç ve seçim listelerinde `unknown` gösterilmez.
    static var selectable: [NotificationChannel] { allCases.filter { $0 != .unknown } }

    var turkishName: String {
        switch self {
        case .whatsapp: return "WhatsApp"
        case .email: return "E-posta"
        case .push: return "Uygulama bildirimi"
        case .unknown: return "Diğer kanal"
        }
    }

    var icon: String {
        switch self {
        case .whatsapp: return "bubble.left.and.bubble.right"
        case .email: return "envelope"
        case .push: return "iphone.gen3.radiowaves.left.and.right"
        case .unknown: return "questionmark.circle"
        }
    }

    /// Müşteriye gerçekten gönderim yapan tek kanal WhatsApp; e-posta müşteriye
    /// kapatıldı. Ekran bunu söylemeli, yoksa kullanıcı kanalı açıp mesajın
    /// neden gitmediğini arar.
    var isDeliverable: Bool { self == .whatsapp }

    /// Müşteriye gidebilecek kanallar — sunucunun `CUSTOMER_CHANNELS`\'ı.
    ///
    /// Klinik müşterisiyle yalnız WhatsApp yazışır. `email` enum\'da **duruyor**:
    /// mesaj günlüğü geçmişte gerçekten gönderilmiş e-posta satırlarını
    /// çözebilmeli ve `staff_internal` personele e-posta atıyor.
    static let customerSelectable: [NotificationChannel] = [.whatsapp]
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
        /// Varsayılan kanal önceliği.
        let channels: [NotificationChannel]
        /// Şablon gövdesinde ve `whatsappVariables` içinde kullanılabilecek adlar.
        let variables: [String]
    }

    // Müşteriye e-posta GİTMEZ: klinik müşterisiyle yalnız WhatsApp üzerinden
    // yazışır. `staffInternal` bir istisna değil, farklı bir alıcı — personele
    // giden iç bildirim.
    static let definitions: [NotificationEvent: Definition] = [
        .appointmentConfirmation: Definition(
            channels: [.whatsapp],
            variables: ["customerName", "branchName", "branchAddress", "appointmentAt", "serviceName"]
        ),
        .appointmentReminder: Definition(
            channels: [.whatsapp],
            variables: ["customerName", "branchName", "branchAddress", "appointmentAt", "serviceName"]
        ),
        .appointmentCancelled: Definition(
            channels: [.whatsapp],
            variables: ["customerName", "branchName", "appointmentAt"]
        ),
        .noShowFollowup: Definition(
            channels: [.whatsapp],
            variables: ["customerName", "branchName"]
        ),
        .packageBalance: Definition(
            channels: [.whatsapp],
            variables: ["customerName", "packageName", "remainingSessions"]
        ),
        .packageExpiring: Definition(
            channels: [.whatsapp],
            variables: ["customerName", "packageName", "expiresAt", "remainingSessions"]
        ),
        .autoReply: Definition(
            channels: [.whatsapp],
            variables: ["message"]
        ),
        .staffInternal: Definition(
            channels: [.email],
            variables: ["subject", "message"]
        ),
    ]

    static func variables(for event: NotificationEvent) -> [String] {
        definitions[event]?.variables ?? []
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

    /// Ekranda görünen `@Etiket`ler; teknik `{{customerName}}` biçimi arayüzde
    /// geçmez. Sunucudaki `packages/shared/src/notification-templates.ts` ile
    /// aynı tablo: canlıda parçalar sunucudan gelir, bu tablo yalnız mock'un ve
    /// `segments` göndermeyen eski bir sunucunun yedeğidir.
    static let variableHandles: [String: String] = [
        "customerName": "@MüşteriAdı",
        "branchName": "@KlinikAdı",
        "branchAddress": "@KlinikAdresi",
        "appointmentAt": "@RandevuZamanı",
        "serviceName": "@HizmetAdı",
        "packageName": "@PaketAdı",
        "remainingSessions": "@KalanSeans",
        "expiresAt": "@SonKullanımTarihi",
        "message": "@Mesaj",
        "subject": "@Konu",
    ]

    /// Tanımsız ad ham haliyle (`@ad`) görünür — sessizce yutulmaz.
    static func handle(for variable: String) -> String {
        variableHandles[variable] ?? "@\(variable)"
    }

    /// Metinde geçen ama bu olayda tanımlı olmayan değişkenler.
    /// Boş dönmesi sunucunun `TEMPLATE_INVALID` vermeyeceği anlamına gelir.
    static func unknownPlaceholders(in text: String, event: NotificationEvent) -> [String] {
        let allowed = Set(variables(for: event))
        return placeholders(in: text).filter { !allowed.contains($0) }
    }
}

// MARK: - Şablon parçaları

/// Şablon gövdesinin bir parçası: düz metin ya da `@HizmetAdı` gibi bir değişken.
///
/// Ekranlar `{{…}}` ayrıştırmaz; sunucunun verdiği parçaları sırayla çizer.
/// Değişken mavi bağlantı renginde görünür — yazılabilir bir metin değil,
/// gönderim anında doldurulan tipli bir alandır.
nonisolated enum TemplateSegment: Decodable, Sendable, Equatable {
    case text(String)
    case variable(name: String, handle: String)

    private enum CodingKeys: String, CodingKey {
        case kind, text, name, handle
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        if kind == "variable" {
            let name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
            let handle = try container.decodeIfPresent(String.self, forKey: .handle)
                ?? NotificationEventCatalog.handle(for: name)
            self = .variable(name: name, handle: handle)
        } else {
            self = .text(try container.decodeIfPresent(String.self, forKey: .text) ?? "")
        }
    }

    /// `Sayın {{customerName}}` → `[.text("Sayın "), .variable(customerName)]`.
    static func parse(_ body: String) -> [TemplateSegment] {
        guard let regex = try? NSRegularExpression(pattern: "\\{\\{\\s*([A-Za-z][A-Za-z0-9_]*)\\s*\\}\\}") else {
            return body.isEmpty ? [] : [.text(body)]
        }
        var result: [TemplateSegment] = []
        var cursor = body.startIndex
        let range = NSRange(body.startIndex..<body.endIndex, in: body)
        for match in regex.matches(in: body, range: range) {
            guard let whole = Range(match.range, in: body),
                  let nameRange = Range(match.range(at: 1), in: body) else { continue }
            if whole.lowerBound > cursor {
                result.append(.text(String(body[cursor..<whole.lowerBound])))
            }
            let name = String(body[nameRange])
            result.append(.variable(name: name, handle: NotificationEventCatalog.handle(for: name)))
            cursor = whole.upperBound
        }
        if cursor < body.endIndex {
            result.append(.text(String(body[cursor...])))
        }
        return result
    }
}

extension Sequence where Element == TemplateSegment {

    /// Düz metin olarak: değişkenler `@Etiket` yazısıyla (renksiz).
    var plainText: String {
        map {
            switch $0 {
            case .text(let text): return text
            case .variable(_, let handle): return handle
            }
        }
        .joined()
    }

    /// Değişkenleri mavi bağlantı renginde gösteren metin.
    func attributed() -> AttributedString {
        var result = AttributedString()
        for segment in self {
            switch segment {
            case .text(let text):
                result += AttributedString(text)
            case .variable(_, let handle):
                var token = AttributedString(handle)
                token.foregroundColor = KlinaraColor.link
                token.inlinePresentationIntent = .stronglyEmphasized
                result += token
            }
        }
        return result
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
    /// Sunucunun parçaladığı gövde. Yalnız eski bir sunucu ya da mock `nil`
    /// bırakır; ekranlar ``segments``i okur.
    var providedSegments: [TemplateSegment]? = nil

    /// Ekranın çizdiği gövde: `@Etiket`li parçalar.
    var segments: [TemplateSegment] { providedSegments ?? TemplateSegment.parse(body) }

    /// `(event, channel, locale)` bileşik anahtarı — sunucudaki upsert anahtarı.
    var rowId: String { "\(event.rawValue)|\(channel.rawValue)|\(locale)" }

    var id: String { rowId }

    private enum CodingKeys: String, CodingKey {
        case templateId = "id"
        case event, channel, locale, subject, body
        case whatsappTemplateName, whatsappTemplateLanguage, whatsappVariables
        case isActive, isDefault, variables
        case providedSegments = "segments"
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
