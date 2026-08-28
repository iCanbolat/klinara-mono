import Foundation

// Kaynak: `apps/api/src/modules/integrations/dto/whatsapp.dto.ts` ve
// `apps/api/src/modules/integrations/dto/webhook.dto.ts`.
//
// İki güvenlik kuralı bu dosyanın biçimini belirliyor:
//
// - **Access token istemciye asla dönmez.** Sunucu onu AES-256-GCM ile saklıyor
//   ve yalnız ``WhatsAppAccount/accessTokenMasked`` gösteriyor. Bu yüzden
//   ``WhatsAppAccount`` `Decodable`, ``UpsertWhatsAppAccountInput`` `Encodable`
//   ve ikisi **ayrı** tip: tek bir `Codable` tip, token'ı okunabilir bir alan
//   gibi gösterirdi.
// - **Gelen numaralar maskeli döner** (`message_log` ile aynı ilke).

nonisolated enum WhatsAppAccountStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case unconfigured
    case active
    case error
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WhatsAppAccountStatus(rawValue: raw) ?? .unknown
    }

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .unconfigured: return "Yapılandırılmadı"
        case .active: return "Bağlı"
        case .error: return "Hata"
        case .unknown: return "Bilinmiyor"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .active: return .positive
        case .error: return .warning
        case .unconfigured, .unknown: return .muted
        }
    }
}

nonisolated enum WhatsAppTemplateStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case pending
    case approved
    case rejected
    case unknown = "UNKNOWN"

    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WhatsAppTemplateStatus(rawValue: raw) ?? .unknown
    }

    var id: String { rawValue }

    var turkishName: String {
        switch self {
        case .pending: return "Onay bekliyor"
        case .approved: return "Onaylı"
        case .rejected: return "Reddedildi"
        case .unknown: return "Bilinmiyor"
        }
    }

    var badgeTone: KlinaraBadge.Tone {
        switch self {
        case .approved: return .positive
        case .rejected: return .warning
        case .pending, .unknown: return .muted
        }
    }
}

/// `WhatsAppAccountResponseDto`.
///
/// Uç yapılandırılmamışken gövde düpedüz `null` döner — bu tipin kendisi değil,
/// **onu saran opsiyonel** o durumu taşır (bkz. ``WhatsAppService/account()``).
nonisolated struct WhatsAppAccount: Decodable, Sendable, Equatable {
    let wabaId: String
    let phoneNumberId: String
    let businessPhone: String?
    let apiVersion: String
    let status: WhatsAppAccountStatus
    /// `••••••••` + son dört karakter. Ham token hiçbir yanıtta yok.
    let accessTokenMasked: String
    /// App secret'ın **varlığı**; değeri değil. Webhook imzası bununla doğrulanıyor.
    let hasAppSecret: Bool
    let lastVerifiedAt: Date?
    let lastError: String?

    /// Webhook imzası doğrulanamıyorsa gelen kutusu hiç dolmaz — kurulum
    /// ekranının en sık gözden kaçan eksiği bu.
    var canVerifyWebhooks: Bool { hasAppSecret }
}

/// `UpsertWhatsAppAccountDto`.
///
/// `accessToken` **zorunlu**: sunucu kısmi güncelleme kabul etmiyor, kayıtlı
/// token da okunamıyor. Düzenleme ekranı bunu kullanıcıya açıkça söylemeli.
nonisolated struct UpsertWhatsAppAccountInput: Encodable, Sendable, Equatable {
    let wabaId: String
    let phoneNumberId: String
    var businessPhone: String?
    let accessToken: String
    var appSecret: String?
    var apiVersion: String?

    static let accessTokenLength = 10...500
    static let appSecretLength = 8...200
}

/// `WhatsAppVerifyResultDto` — `POST /integrations/whatsapp/verify`.
nonisolated struct WhatsAppVerifyResult: Decodable, Sendable, Equatable {
    let ok: Bool
    let error: String?
    let templateCount: Int
}

nonisolated struct WhatsAppTemplateButton: Decodable, Sendable, Equatable {
    let type: String
    let text: String
}

/// `WhatsAppTemplateResponseDto` — Meta'dan senkronlanan onaylı şablonlar.
nonisolated struct WhatsAppTemplate: Decodable, Sendable, Equatable {
    let name: String
    let language: String
    let category: String?
    let status: WhatsAppTemplateStatus
    /// Gövdenin beklediği `{{1}}, {{2}}…` sayısı.
    let bodyVariableCount: Int
    let buttons: [WhatsAppTemplateButton]
    let syncedAt: Date?

    /// `(name, language)` tekil — Meta aynı şablonu birden çok dilde tutar.
    var rowId: String { "\(name)|\(language)" }

    /// Test gönderimi sunucuda **sıfır parametreyle** yapılıyor; değişken
    /// bekleyen bir şablon Meta tarafından reddedilir.
    var isTestable: Bool { status == .approved && bodyVariableCount == 0 }
}

/// `WhatsAppTestSendDto`.
nonisolated struct SendTestMessageInput: Encodable, Sendable, Equatable {
    let to: String
    let templateName: String
    var templateLanguage: String?
}

/// `WhatsAppTestResultDto`.
nonisolated struct SendTestMessageResult: Decodable, Sendable, Equatable {
    let accepted: Bool
    let providerMessageId: String?
}

/// `InboxItemDto` — müşterinin WhatsApp'tan yazdığı serbest metin.
///
/// Buton yanıtları (Onayla / İptal Et) buraya düşmez; onları sunucu doğrudan
/// randevu durumuna çeviriyor. Burada duran, personelin **okuması gereken**
/// mesajdır.
nonisolated struct InboxItem: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    /// Numara kayıtlı bir müşteriyle eşleşmediyse `nil`.
    let customerId: String?
    /// Maskeli gönderen numarası.
    let from: String
    /// Meta'nın `message.type` alanının **serbest** geçişi — enum değil.
    /// Sunucu bilinmeyen bir tür geldiğinde onu olduğu gibi yazıyor.
    let messageType: String
    let body: String?
    let receivedAt: Date
    /// `nil` = henüz işlenmedi. Gelen kutusunda "durum" diye ayrı bir enum yok.
    let handledAt: Date?

    var isHandled: Bool { handledAt != nil }

    var messageTypeLabel: String {
        switch messageType {
        case "text": return "Metin"
        case "button": return "Buton yanıtı"
        case "interactive": return "Etkileşimli yanıt"
        case "image": return "Görsel"
        case "audio": return "Ses"
        case "document": return "Belge"
        default: return messageType
        }
    }

    /// Metin dışındaki türlerde gövde boş gelebilir; listede boş satır
    /// göstermemek için.
    var preview: String {
        if let body, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return body
        }
        return "(\(messageTypeLabel))"
    }
}
