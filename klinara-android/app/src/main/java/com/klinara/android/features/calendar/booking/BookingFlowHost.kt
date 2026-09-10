package com.klinara.android.features.calendar.booking

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.Appointment
import com.klinara.android.services.networking.ApiError

/**
 * Rezervasyon ekranının kabuğu.
 *
 * Erteleme, formu kurmadan **önce** randevunun kendisini ister: taslak mevcut hizmet
 * dizilimini, personelini ve paket bağlarını ondan kopyalıyor ve `If-Match` için taze
 * bir sürüm gerekiyor. Gezinme argümanında yalnız kimlik taşınır — kaydın kendisi değil,
 * çünkü argümanda taşınan bir kayıt bayatlar.
 */
@Composable
fun BookingFlowHost(
    rescheduleId: String?,
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    onCreated: (Appointment) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (rescheduleId == null) {
        BookingFlowScreen(
            session = session,
            container = container,
            onBack = onBack,
            onCreated = onCreated,
            modifier = modifier,
        )
        return
    }

    var existing by remember(rescheduleId) { mutableStateOf<Appointment?>(null) }
    var error by remember(rescheduleId) { mutableStateOf<String?>(null) }

    LaunchedEffect(rescheduleId) {
        try {
            existing = container.booking.appointment(rescheduleId)
        } catch (failure: ApiError) {
            error = failure.displayMessage
        }
    }

    when {
        error != null ->
            KlinaraScreen(title = "Randevuyu ertele", onBack = onBack, modifier = modifier) {
                ErrorBanner(message = error.orEmpty())
            }

        existing == null ->
            KlinaraScreen(title = "Randevuyu ertele", onBack = onBack, modifier = modifier) {
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            }

        else ->
            BookingFlowScreen(
                session = session,
                container = container,
                onBack = onBack,
                onCreated = onCreated,
                rescheduling = existing,
                modifier = modifier,
            )
    }
}
