package com.klinara.android.features.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.NotificationsService
import com.klinara.android.services.notifications.ScheduledNotification
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Randevunun bildirim planı (A8.1; A3.3'ten ertelenmişti) — iOS `AppointmentNotificationsSection`.
 *
 * **Salt okunur**: hatırlatmalar randevunun kendi transaction'ında planlanıyor ve tek tek iptal
 * edilemiyor. `cancelled`/`superseded` satırlar da gösterilir — yalnız `pending` göstermek, randevu
 * ertelendiğinde eski planın nereye gittiği sorusunu cevapsız bırakırdı.
 *
 * İzin kapısı YOK: uç `appointment:read.*` istiyor ve detay ekranı zaten o izinle açılıyor.
 * Kendi ViewModel'i ve kendi hatası var; düşerse detayın geri kalanı çizilmeye devam eder.
 */
@Composable
fun AppointmentNotificationsSection(
    container: ServiceContainer,
    appointmentId: String,
    clock: BranchClock,
    modifier: Modifier = Modifier,
) {
    val viewModel: AppointmentNotificationsViewModel =
        viewModel(
            key = "appointment-notifications-$appointmentId",
            factory = AppointmentNotificationsViewModel.factory(container, appointmentId),
        )
    val rows by viewModel.rows.collectAsStateWithLifecycle()

    LaunchedEffect(appointmentId) { viewModel.load() }

    KlinaraCard(
        title = "Bildirimler",
        footnote = "Hatırlatma saatleri şube ayarından gelir. Randevu ertelenirse eski plan düşer, yenisi kurulur.",
        modifier = modifier,
    ) {
        when (val state = rows) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = state.message, onRetry = if (state.isRetryable) viewModel::load else null)
            is Loadable.Loaded ->
                if (state.value.isEmpty()) {
                    Text(
                        "Bu randevu için planlanmış bildirim yok.",
                        style = KlinaraType.bodyM,
                        color = KlinaraTheme.colors.charcoalMuted,
                    )
                } else {
                    state.value.forEachIndexed { index, row ->
                        if (index > 0) KlinaraDivider()
                        NotificationRow(row, clock)
                    }
                }
        }
    }
}

@Composable
private fun NotificationRow(
    row: ScheduledNotification,
    clock: BranchClock,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                row.event.turkishName,
                style = KlinaraType.bodyEmphasis,
                color = KlinaraTheme.colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            KlinaraBadge(row.status.turkishName, tone = row.status.badgeTone)
        }
        Text(
            "${row.offsetLabel} · ${clock.formatDateTime(row.scheduledFor)}",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}

class AppointmentNotificationsViewModel(
    private val service: NotificationsService,
    private val appointmentId: String,
) : ViewModel() {
    private val _rows = MutableStateFlow<Loadable<List<ScheduledNotification>>>(Loadable.Loading)
    val rows: StateFlow<Loadable<List<ScheduledNotification>>> = _rows.asStateFlow()

    /** Detaya her dönüşte koşar: ertelemeden sonra plan değişmiş olabilir. */
    fun load() {
        viewModelScope.launch { _rows.value = Loadable.of { service.appointmentNotifications(appointmentId) } }
    }

    companion object {
        fun factory(
            container: ServiceContainer,
            appointmentId: String,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    AppointmentNotificationsViewModel(container.notifications, appointmentId) as T
            }
    }
}
