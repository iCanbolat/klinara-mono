package com.klinara.android.services.push

import android.content.Intent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Bildirime dokununca açılacak yer.
 *
 * Push yükü YALNIZ kimlik taşır; müşteri adı ya da mesaj metni yükte yok (kilit
 * ekranında sağlık verisi görünmemeli). Ayrıntı uygulamanın içinde, yetkiyle okunur.
 */
object PushRouter {
    const val EXTRA_APPOINTMENT_ID = "appointmentId"

    private val _pendingAppointmentId = MutableStateFlow<String?>(null)

    /** Kabuk bunu tüketip [consume] çağırır. */
    val pendingAppointmentId: StateFlow<String?> = _pendingAppointmentId.asStateFlow()

    /**
     * FCM arka plandaki bildirimin `data` alanını açılış intent'inin extra'larına
     * koyuyor; öndeyken kendi kurduğumuz bildirim de aynı anahtarı kullanıyor.
     */
    fun handle(intent: Intent?) {
        val id = intent?.getStringExtra(EXTRA_APPOINTMENT_ID)?.takeIf { it.isNotBlank() } ?: return
        _pendingAppointmentId.value = id
        // Aynı intent döndürmede yeniden işlenmesin.
        intent.removeExtra(EXTRA_APPOINTMENT_ID)
    }

    fun consume() {
        _pendingAppointmentId.value = null
    }
}
