package com.klinara.android.services.notifications

/**
 * Bildirim uçları — iOS `NotificationsService` paritesi.
 *
 * Randevu bildirim planı A8.1'de, şablon/hatırlatma ayarı A8.2'de geldi.
 * Mesaj günlüğü `MessagesService`'te — sunucudaki
 * modül sınırlarının aynası.
 *
 * **İzin `customer:*` DEĞİL:** okuma `notification:read`, yazma `notification:manage`.
 */
interface NotificationsService {
    /**
     * `GET appointments/:id/notifications` — izin `appointment:read.*` (bildirim izni DEĞİL).
     *
     * **Çıplak dizi.** `cancelled` ve `superseded` satırlar da gelir: "hatırlatma neden
     * gitmedi" sorusunun cevabı tam da onlarda.
     */
    suspend fun appointmentNotifications(appointmentId: String): List<ScheduledNotification>

    /** `GET notification-templates` — çıplak dizi, birleştirilmiş etkin görünüm. `notification:read`. */
    suspend fun templates(): List<NotificationTemplate>

    /**
     * `PUT notification-templates` — `(event, channel, locale)` üzerinde upsert. `notification:manage`.
     * Bilinmeyen yer tutucu `422 TEMPLATE_INVALID`.
     */
    suspend fun upsertTemplate(input: NotificationTemplateUpsert): NotificationTemplate

    /** `GET branches/:id/reminder-settings` — çözülmüş ayar. */
    suspend fun reminderSettings(branchId: String): BranchReminderSettings

    /** `PUT branches/:id/reminder-settings` — kısmi; yanıt yine çözülmüş ayar. `notification:manage`. */
    suspend fun updateReminderSettings(
        branchId: String,
        update: ReminderSettingsUpdate,
    ): BranchReminderSettings
}
