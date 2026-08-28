import Foundation

/// Bildirim **yapılandırması**: şablonlar, tercihler, hatırlatma ayarları ve
/// iletişim izni (Faz 8.1 / 8.4).
///
/// ``MessagesService`` ve ``WhatsAppService``den ayrı, ``CommissionsService``in
/// ``FinanceService``den ayrılmasıyla aynı gerekçeyle: izin ailesi farklı.
/// Burası ağırlıklı `notification:manage`; mesaj günlüğü salt `notification:read`,
/// gönderim `notification:send`. Sunucu bu üçünü **birbirine bindirmiyor** —
/// resepsiyon tek tek mesaj gönderebilir ama kiracı şablonunu değiştiremez.
/// Tek bir sözleşme bu ayrımı kodda görünmez kılardı.
protocol NotificationsService: Sendable {

    /// `GET /notification-templates` — yanıt **çıplak dizi**, `{ data: … }` zarfı YOK.
    ///
    /// Liste *birleştirilmiş etkin görünüm*: kiracı satırı olmayan her
    /// (olay, kanal) çifti kod varsayılanıyla `isDefault: true` ve `id: nil` gelir.
    func templates() async throws -> [NotificationTemplate]

    /// `PUT /notification-templates` — `(event, channel, locale)` anahtarıyla upsert.
    ///
    /// Gövdedeki `{{…}}` yer tutucuları olayın izinli değişkenlerinden değilse
    /// sunucu `422 TEMPLATE_INVALID` döner; ``NotificationEventCatalog`` bunu
    /// kaydete basmadan önce yakalamak için var.
    func upsertTemplate(_ input: UpsertNotificationTemplateInput) async throws -> NotificationTemplate

    /// `GET /notification-preferences` — **çıplak dizi**.
    ///
    /// Aynı olay için birden çok satır dönebilir: bir kiracı varsayılanı
    /// (`branchId == nil`) ve şube başına birer override.
    func preferences() async throws -> [NotificationPreference]

    /// `PUT /notification-preferences` — `(event, branchId)` anahtarıyla upsert.
    ///
    /// Sessiz saatin iki ucundan yalnız biri gönderilirse `VALIDATION_FAILED`.
    func upsertPreference(
        _ input: UpsertNotificationPreferenceInput
    ) async throws -> NotificationPreference

    /// `GET /branches/:id/reminder-settings` — şube override'ı yoksa kiracı
    /// ayarı **çözülmüş** olarak döner.
    func reminderSettings(branchId: String) async throws -> BranchReminderSettings

    /// `PUT /branches/:id/reminder-settings` — kısmi birleştirme; yanıt yine
    /// çözülmüş ayar.
    func updateReminderSettings(
        branchId: String,
        _ input: UpdateBranchReminderSettingsInput
    ) async throws -> BranchReminderSettings

    /// `GET /appointments/:id/notifications` — **çıplak dizi**. `cancelled` ve
    /// `superseded` satırları da gelir, bilerek.
    func appointmentNotifications(appointmentId: String) async throws -> [ScheduledNotification]

    /// `GET /customers/:id/opt-out` — **çıplak dizi**, yalnız yürürlükteki kayıtlar.
    func optOuts(customerId: String) async throws -> [OptOutRecord]

    /// `POST /customers/:id/opt-out` — aynı kapsamda ikinci kayıt hata değil,
    /// var olan kaydı döndürür (sunucu bunu idempotent tutuyor).
    func createOptOut(customerId: String, _ input: CreateOptOutInput) async throws -> OptOutRecord

    /// `DELETE /customers/:id/opt-out` — `channel` verilmezse tüm kapsamı kaldırır.
    /// Kayıt silinmez, `revoked_at` damgalanır; yanıt gövdesiz (`204`).
    func revokeOptOut(customerId: String, channel: NotificationChannel?) async throws
}

struct LiveNotificationsService: NotificationsService {

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func templates() async throws -> [NotificationTemplate] {
        try await client.send(APIRequest.get("notification-templates"))
    }

    func upsertTemplate(
        _ input: UpsertNotificationTemplateInput
    ) async throws -> NotificationTemplate {
        try await client.send(APIRequest.put("notification-templates", body: input))
    }

    func preferences() async throws -> [NotificationPreference] {
        try await client.send(APIRequest.get("notification-preferences"))
    }

    func upsertPreference(
        _ input: UpsertNotificationPreferenceInput
    ) async throws -> NotificationPreference {
        try await client.send(APIRequest.put("notification-preferences", body: input))
    }

    func reminderSettings(branchId: String) async throws -> BranchReminderSettings {
        try await client.send(APIRequest.get("branches/\(branchId)/reminder-settings"))
    }

    func updateReminderSettings(
        branchId: String,
        _ input: UpdateBranchReminderSettingsInput
    ) async throws -> BranchReminderSettings {
        try await client.send(APIRequest.put("branches/\(branchId)/reminder-settings", body: input))
    }

    func appointmentNotifications(appointmentId: String) async throws -> [ScheduledNotification] {
        try await client.send(APIRequest.get("appointments/\(appointmentId)/notifications"))
    }

    func optOuts(customerId: String) async throws -> [OptOutRecord] {
        try await client.send(APIRequest.get("customers/\(customerId)/opt-out"))
    }

    func createOptOut(
        customerId: String,
        _ input: CreateOptOutInput
    ) async throws -> OptOutRecord {
        try await client.send(APIRequest.post("customers/\(customerId)/opt-out", body: input))
    }

    func revokeOptOut(customerId: String, channel: NotificationChannel?) async throws {
        var query: [URLQueryItem] = []
        if let channel { query.append(URLQueryItem(name: "channel", value: channel.rawValue)) }
        try await client.send(APIRequest(
            method: .delete,
            path: "customers/\(customerId)/opt-out",
            query: query
        ))
    }
}
