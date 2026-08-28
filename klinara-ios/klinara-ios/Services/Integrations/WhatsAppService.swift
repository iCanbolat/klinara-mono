import Foundation

/// WhatsApp entegrasyonu ve gelen kutusu (Faz 8.2 / 8.3).
///
/// ``NotificationsService``den ayrı: burada `notification:manage` (kimlik
/// bilgileri) ile `notification:send` (test gönderimi, gelen mesajı işlendi
/// işaretleme) iç içe geçiyor ve ekran ailesi bir *entegrasyon kurulumu*,
/// bir bildirim ayarı değil.
///
/// Webhook uçları (`GET|POST /webhooks/whatsapp`) burada YOK: onlar Meta'nın
/// sunucuya konuştuğu public uçlar, istemcinin işi değil.
protocol WhatsAppService: Sendable {

    /// `GET /integrations/whatsapp` — hesap yapılandırılmamışsa `200` ile
    /// **boş gövde** döner (denetleyici `null` veriyor, Nest onu hiç yazmıyor).
    /// Dönüş bu yüzden opsiyonel; `nil` bir **hata değil**, "henüz kurulmadı"
    /// demek ve ekran boş durumu gösterir.
    func account() async throws -> WhatsAppAccount?

    /// `PUT /integrations/whatsapp` — `accessToken` zorunlu ve **yazma-yalnız**.
    /// Kaydetmek hesabı doğrulanmamış duruma düşürür; ardından ``verify()``.
    func upsertAccount(_ input: UpsertWhatsAppAccountInput) async throws -> WhatsAppAccount

    /// `POST /integrations/whatsapp/verify` — kimlik bilgilerini Meta'ya karşı
    /// sınar ve şablonları senkronlar. Başarısızlık `ok: false` ile döner,
    /// hata **fırlatmaz**: bu bir doğrulama sonucu, bir istek hatası değil.
    func verify() async throws -> WhatsAppVerifyResult

    /// `GET /integrations/whatsapp/templates` — **çıplak dizi**, son senkronun
    /// bıraktığı satırlar.
    func templates() async throws -> [WhatsAppTemplate]

    /// `POST /integrations/whatsapp/test` — sunucu şablonu **sıfır parametreyle**
    /// gönderiyor; değişken bekleyen şablon Meta tarafından reddedilir.
    /// Kalıcı hatalar `422`, geçici hatalar `503` olarak gelir.
    func sendTest(_ input: SendTestMessageInput) async throws -> SendTestMessageResult

    /// `GET /inbox` — **çıplak dizi**, sayfalama YOK: sunucu yalnız `limit`
    /// alıyor, cursor vermiyor. Ekran sonsuz kaydırma sunmamalı.
    func inbox(onlyUnhandled: Bool, limit: Int?) async throws -> [InboxItem]

    /// `POST /inbox/:id/handle` — yanıt gövdesiz (`204`).
    func markInboxHandled(id: String) async throws
}

struct LiveWhatsAppService: WhatsAppService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func account() async throws -> WhatsAppAccount? {
        try await client.sendOptional(APIRequest.get("integrations/whatsapp"))
    }

    func upsertAccount(_ input: UpsertWhatsAppAccountInput) async throws -> WhatsAppAccount {
        try await client.send(APIRequest.put("integrations/whatsapp", body: input))
    }

    func verify() async throws -> WhatsAppVerifyResult {
        try await client.send(APIRequest.post("integrations/whatsapp/verify"))
    }

    func templates() async throws -> [WhatsAppTemplate] {
        try await client.send(APIRequest.get("integrations/whatsapp/templates"))
    }

    func sendTest(_ input: SendTestMessageInput) async throws -> SendTestMessageResult {
        try await client.send(APIRequest.post("integrations/whatsapp/test", body: input))
    }

    func inbox(onlyUnhandled: Bool, limit: Int?) async throws -> [InboxItem] {
        var query = [URLQueryItem(name: "onlyUnhandled", value: onlyUnhandled ? "true" : "false")]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try await client.send(APIRequest.get("inbox", query: query))
    }

    func markInboxHandled(id: String) async throws {
        try await client.send(APIRequest.post("inbox/\(id)/handle"))
    }
}
