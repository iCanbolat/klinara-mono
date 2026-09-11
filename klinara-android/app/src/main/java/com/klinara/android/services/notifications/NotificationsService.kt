package com.klinara.android.services.notifications

/**
 * Bildirim uçları — iOS `NotificationsService` paritesi.
 *
 * **Opt-out dilimi A4.2'de** geldi (müşteri kartının iletişim tercihi bölümü onsuz
 * çizilemezdi); randevu bildirim planı A8.1'de, şablon/tercih/hatırlatma ayarı A8.2'de.
 * Gelen kutusu `WhatsAppService`'te, mesaj günlüğü `MessagesService`'te — sunucudaki
 * modül sınırlarının aynası.
 *
 * **İzin `customer:*` DEĞİL:** okuma `notification:read`, yazma `notification:manage`.
 * Müşteri kartında duran bir bölümün müşteri iznine bağlı olmaması şaşırtıcı ama
 * doğru — kayıt bir iletişim kaydıdır, bir müşteri alanı değil.
 */
interface NotificationsService {
    /**
     * `GET appointments/:id/notifications` — izin `appointment:read.*` (bildirim izni DEĞİL).
     *
     * **Çıplak dizi.** `cancelled` ve `superseded` satırlar da gelir: "hatırlatma neden
     * gitmedi" sorusunun cevabı tam da onlarda.
     */
    suspend fun appointmentNotifications(appointmentId: String): List<ScheduledNotification>

    /**
     * `GET customers/:id/opt-out` — `notification:read`.
     *
     * ⚠️ **Çıplak dizi** döndürür, zarf YOK. `customers/search` ile birlikte
     * sözleşmedeki iki istisnadan biri.
     */
    suspend fun optOuts(customerId: String): List<OptOutRecord>

    /**
     * `POST customers/:id/opt-out` — `notification:manage`.
     *
     * [channel] verilmezse **TÜM kanallar** kapanır.
     */
    suspend fun createOptOut(
        customerId: String,
        channel: NotificationChannel? = null,
        source: OptOutSource? = null,
        note: String? = null,
    ): OptOutRecord

    /**
     * `DELETE customers/:id/opt-out?channel=` — `notification:manage`, 204.
     *
     * Kayıt SİLİNMEZ, `revoked_at` damgalanır: rızanın geri alındığı da bir izdir.
     */
    suspend fun revokeOptOut(
        customerId: String,
        channel: NotificationChannel? = null,
    )
}
