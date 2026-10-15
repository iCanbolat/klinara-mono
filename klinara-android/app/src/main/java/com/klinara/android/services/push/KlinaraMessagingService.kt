package com.klinara.android.services.push

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.klinara.android.KlinaraApplication
import com.klinara.android.R
import com.klinara.android.app.MainActivity
import kotlinx.coroutines.launch

/**
 * FCM giriş noktası.
 *
 * Uygulama ARKA PLANDAYKEN bildirimi sistem kendisi çizer (sunucu `notification`
 * alanı gönderiyor) ve dokununca `data` alanı açılış intent'ine extra olarak gelir.
 * ÖNDEYKEN FCM çizmez, buraya düşer: aynı bildirimi biz kuruyoruz ki başka ekrandaki
 * personel yeni online randevuyu kaçırmasın.
 */
class KlinaraMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as KlinaraApplication
        app.appScope.launch { PushRegistrar.onNewToken(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        val granted =
            android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        if (!granted) return

        val intent =
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                message.data[PushRouter.EXTRA_APPOINTMENT_ID]?.let { putExtra(PushRouter.EXTRA_APPOINTMENT_ID, it) }
            }
        val pending =
            PendingIntent.getActivity(
                this,
                message.messageId?.hashCode() ?: 0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val built =
            NotificationCompat
                .Builder(this, PushChannels.STAFF)
                .setSmallIcon(R.drawable.ic_klinara_bell)
                .setContentTitle(notification.title)
                .setContentText(notification.body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(pending)
                .build()
        // Aynı sohbetten gelenler üst üste binsin (sunucu `tag` = collapse anahtarı).
        @Suppress("MissingPermission") // izin yukarıda denetlendi
        NotificationManagerCompat.from(this).notify(notification.tag, 0, built)
    }
}
