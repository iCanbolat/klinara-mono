package com.klinara.android.services.notifications

/**
 * Bildirim uçları — **yalnız opt-out dilimi**.
 *
 * Doküman bu servisi A8.1'e koyuyor; **üç metodu A4.2'ye alındı** çünkü müşteri
 * kartının iletişim tercihi bölümü onlarsız çizilemez. A3'ün `booking`, `staff` ve
 * `catalog`'u öne alma deseninin aynısı: gerçek metot, gerçek çağıran, kendi mock'u.
 *
 * Gelen kutusu, mesaj günlüğü, şablonlar ve tercihler A8'de bu arayüzün üstüne biner.
 * Bugün çağıranı olmayan on metot yazmak, okunmamış uçlar için imza tahmini kodlamak
 * olurdu (§A0.5).
 *
 * **İzin `customer:*` DEĞİL:** okuma `notification:read`, yazma `notification:manage`.
 * Müşteri kartında duran bir bölümün müşteri iznine bağlı olmaması şaşırtıcı ama
 * doğru — kayıt bir iletişim kaydıdır, bir müşteri alanı değil.
 */
interface NotificationsService {
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
