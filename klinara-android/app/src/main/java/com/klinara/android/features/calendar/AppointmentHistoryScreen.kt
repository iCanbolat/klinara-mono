package com.klinara.android.features.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.booking.AppointmentHistoryEntry
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable

/**
 * Salt okunur denetim izi.
 *
 * `createdAt` sunucudan **UTC** gelir (randevu saatlerinin aksine, onlar şube offset'li);
 * gösterim yine `BranchClock` ile yapılır — cihaz saat dilimi hiçbir yerde kullanılmaz.
 */
@Composable
fun AppointmentHistoryScreen(
    appointmentId: String,
    session: AppSession,
    container: ServiceContainer,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }
    val viewModel: AppointmentHistoryViewModel =
        viewModel(
            key = "history-$appointmentId",
            factory = AppointmentHistoryViewModel.factory(container, appointmentId),
        )
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(appointmentId) { viewModel.load() }

    KlinaraScreen(title = "Geçmiş", onBack = onBack, modifier = modifier) {
        when (val history = state) {
            Loadable.Loading ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.rows)

            is Loadable.Failed ->
                ErrorBanner(
                    message = history.message,
                    onRetry = if (history.isRetryable) viewModel::load else null,
                )

            is Loadable.Loaded ->
                if (history.value.isEmpty()) {
                    EmptyStateView(
                        title = "Kayıt yok",
                        message = "Bu randevuda henüz bir değişiklik yapılmamış.",
                        icon = Icons.Filled.DateRange,
                    )
                } else {
                    KlinaraCard {
                        // Yeniden eskiye: en son ne olduğu ilk sorulan şey.
                        history.value.sortedByDescending { it.createdAt }.forEachIndexed { index, entry ->
                            if (index > 0) KlinaraDivider()
                            HistoryRow(entry, clock)
                        }
                    }
                }
        }
    }
}

@Composable
private fun HistoryRow(
    entry: AppointmentHistoryEntry,
    clock: BranchClock,
) {
    val colors = KlinaraTheme.colors
    val detail = describeChange(entry, clock)
    val label = buildString {
        append(clock.formatDateTime(entry.createdAt))
        append(", ${entry.action.turkishName}")
        if (detail != null) append(", $detail")
        entry.reason?.let { append(", sebep: $it") }
    }

    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            Text(
                entry.action.turkishName,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            Text(clock.formatDateTime(entry.createdAt), style = KlinaraType.label, color = colors.charcoalMuted)
        }
        detail?.let { Text(it, style = KlinaraType.bodyM, color = colors.charcoalMuted) }
        entry.reason?.let { Text("Sebep: $it", style = KlinaraType.bodyM, color = colors.charcoalMuted) }
    }
}

/** Durum ve saat değişikliklerini tek cümleye indirir; ikisi de yoksa satır sade kalır. */
private fun describeChange(
    entry: AppointmentHistoryEntry,
    clock: BranchClock,
): String? {
    val status =
        entry.toStatus?.let { to ->
            entry.fromStatus?.let { from -> "${from.turkishName} → ${to.turkishName}" } ?: to.turkishName
        }
    val moved =
        entry.newStartsAt?.let { new ->
            entry.oldStartsAt?.let { old -> "${clock.formatDateTime(old)} → ${clock.formatDateTime(new)}" }
        }
    return listOfNotNull(status, moved).takeIf { it.isNotEmpty() }?.joinToString(" · ")
}
