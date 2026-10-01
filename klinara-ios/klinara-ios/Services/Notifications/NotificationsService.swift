import Foundation

/// Bildirim **yapılandırması**: şablonlar ve hatırlatma ayarları
/// (Faz 8.1 / 8.4).
///
/// ``MessagesService`` ve ``WhatsAppService``den ayrı, çünkü izin ailesi farklı.
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
}
