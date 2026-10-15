package com.klinara.android.services.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

/**
 * Bildirim kanalı — sunucunun FCM isteğindeki `channel_id` ile AYNI kimlik
 * (`fcm.sender.ts` → `ANDROID_CHANNEL_ID`). Kanal yoksa bildirim düşer (minSdk 26).
 */
object PushChannels {
    const val STAFF = "staff_notifications"

    fun ensure(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel =
            NotificationChannel(STAFF, "Klinik bildirimleri", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Online randevu, iptal, saat değişikliği ve WhatsApp mesajları"
                // Kilit ekranında başlık görünür, ayrıntı görünmez.
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            }
        manager.createNotificationChannel(channel)
    }
}
