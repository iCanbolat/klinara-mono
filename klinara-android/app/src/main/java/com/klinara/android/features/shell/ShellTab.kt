package com.klinara.android.features.shell

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.contracts.Permissions
import kotlinx.serialization.Serializable

/**
 * Alt gezinme sekmeleri.
 *
 * **Sekme kümesi kalıcıdır.** A3–A9 sekme EKLEMEZ, var olanı doldurur; bilgi
 * mimarisini her fazda yeniden kurmak kullanıcının kas hafızasını her sürümde
 * sıfırlamak demektir. iOS `AppShellView` ile birebir aynı dörtlü.
 *
 * Görünürlük **saf bir fonksiyondur** (izin kümesi → sekme kümesi): bu yüzden
 * `ShellTabTest` altı rolün altısını da elle emülatör gezmeden doğrulayabiliyor.
 */
enum class ShellTab(
    val label: String,
    val icon: ImageVector,
) {
    Today("Bugün", Icons.Filled.DateRange),
    Customers("Müşteriler", Icons.Filled.Person),
    Management("Yönetim", Icons.Filled.Settings),
    Profile("Profil", Icons.Filled.AccountCircle),
    ;

    fun isVisible(session: AppSession): Boolean =
        when (this) {
            // Bugün ve Profil HER ZAMAN çizilir. Varsayılan seçili sekmenin bazı
            // rollerde kaybolması, bilgi mimarisini role göre değiştirmek olurdu;
            // izin yoksa sekme durur ama içerik "erişiminiz yok" der.
            Today, Profile -> true
            Customers -> session.can(Permissions.CUSTOMER_READ)
            Management -> session.canAny(MANAGEMENT_PERMISSIONS)
        }

    companion object {
        /**
         * Yönetim sekmesini açan izinler.
         *
         * **Finans izinlerinin burada olması iOS'ta bir DÜZELTMEYDİ.** `accountant`
         * rolünde `service:read`, `staff:read`, `schedule:read` yok; eski koşulla
         * muhasebe sekmeyi hiç göremiyor, dolayısıyla kendisi için yazılmış Kasa ve
         * Prim ekranlarına da hiç ulaşamıyordu.
         */
        val MANAGEMENT_PERMISSIONS =
            setOf(
                Permissions.SERVICE_READ,
                Permissions.STAFF_READ,
                Permissions.SCHEDULE_READ,
                Permissions.FINANCE_PAYMENT_READ,
                Permissions.FINANCE_COMMISSION_READ,
                Permissions.NOTIFICATION_READ,
                Permissions.NOTIFICATION_MANAGE,
            )

        fun visibleFor(session: AppSession): List<ShellTab> = entries.filter { it.isVisible(session) }

        /**
         * Takvim içeriği çizilsin mi?
         *
         * Sekmenin görünürlüğünden AYRI bir soru: `accountant` sekmeyi görür ama
         * randevuları göremez.
         */
        fun canSeeCalendar(session: AppSession): Boolean =
            session.canAny(Permissions.APPOINTMENT_READ_ALL, Permissions.APPOINTMENT_READ_OWN)
    }
}

/**
 * Sekme başına gezinme grafiğinin başlangıç hedefleri.
 *
 * A2'de her grafiğin tek hedefi var; tip güvenli route'lar yine de şimdi kuruluyor ki
 * A3–A9 ekran eklerken kabuk yeniden yazılmasın.
 */
object ShellRoutes {
    @Serializable
    data object TodayHome

    /**
     * Randevu detayı — bir sheet DEĞİL, gerçek bir hedef (§5.3, Kural 2).
     *
     * iOS'ta bu bir `sheet`; Android'de geri yığınında bir kayıt olmalı ki tahmini geri
     * (predictive back) ve sistem geri tuşu kendiliğinden çalışsın. A2.1'de sekme başına
     * `NavHost` kurmanın sebebi tam buydu.
     */
    @Serializable
    data class AppointmentDetail(
        val appointmentId: String,
    )

    @Serializable
    data class AppointmentHistory(
        val appointmentId: String,
    )

    /**
     * Randevu oluşturma / erteleme.
     *
     * [rescheduleId] doluysa bu bir ERTELEME. İki ayrı hedef yerine tek hedef: form
     * aynı, değişen yalnız kilitli alanlar ve düğme metni; ikiye bölmek aynı ekranı iki
     * kez yazmak olurdu.
     */
    @Serializable
    data class BookingFlow(
        val rescheduleId: String? = null,
    )

    @Serializable
    data object CustomerList

    @Serializable
    data object ManagementHome

    @Serializable
    data object ProfileHome
}
