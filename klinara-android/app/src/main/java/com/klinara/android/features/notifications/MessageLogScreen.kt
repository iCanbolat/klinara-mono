package com.klinara.android.features.notifications

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraButton
import com.klinara.android.designsystem.components.KlinaraButtonKind
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.features.customers.SelectableChip
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.NotificationEvent

/**
 * Mesaj günlüğü (A8.1) — iOS `MessageLogView` paritesi: "gitti mi, gitmediyse neden?"
 *
 * `skipped` satırları **gizlenmez** (Ek M). Sonraki sayfa A5.4 emsaliyle açık bir düğmeyle
 * istenir; düşerse satırlar korunur ve hata listenin sonunda "Tekrar dene" ile çıkar.
 */
@Composable
fun MessageLogScreen(
    state: MessageLogUiState,
    clock: BranchClock,
    onStatus: (MessageStatusFilter) -> Unit,
    onChannel: (MessageChannelFilter) -> Unit,
    onEvent: (NotificationEvent) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Mesaj günlüğü", modifier = modifier, onBack = onBack) {
        Filters(state, onStatus, onChannel, onEvent)

        when (val messages = state.messages) {
            Loadable.Loading ->
                Text("Yükleniyor…", style = KlinaraType.bodyM, color = KlinaraTheme.colors.charcoalMuted)
            is Loadable.Failed ->
                ErrorBanner(message = messages.message, onRetry = if (messages.isRetryable) onRetry else null)
            is Loadable.Loaded ->
                if (messages.value.isEmpty()) {
                    EmptyStateView(
                        title = "Mesaj yok",
                        message =
                            if (state.filter.isActive) {
                                "Seçtiğiniz süzgeçlere uyan mesaj bulunamadı."
                            } else {
                                "Henüz hiçbir bildirim üretilmedi."
                            },
                        icon = Icons.Filled.Email,
                    )
                } else {
                    KlinaraCard(title = "Mesajlar", footnote = footnote(state)) {
                        messages.value.forEachIndexed { index, message ->
                            if (index > 0) KlinaraDivider()
                            MessageRow(message, clock, onClick = { onOpen(message.id) })
                        }
                    }
                    state.loadMoreError?.let { ErrorBanner(message = it, onRetry = onLoadMore) }
                    if (state.nextCursor != null && state.loadMoreError == null) {
                        KlinaraButton(
                            title = "Sonraki sayfa",
                            onClick = onLoadMore,
                            kind = KlinaraButtonKind.Tertiary,
                            isLoading = state.isLoadingMore,
                        )
                    }
                }
        }
    }
}

private fun footnote(state: MessageLogUiState): String =
    buildString {
        append("Numaralar maskeli tutulur; ham adres kaydedilmez.")
        if (state.status == MessageStatusFilter.Delivered) {
            append(" \"Ulaştı\" süzgeci okunan mesajları kapsamaz.")
        }
    }

@Composable
private fun Filters(
    state: MessageLogUiState,
    onStatus: (MessageStatusFilter) -> Unit,
    onChannel: (MessageChannelFilter) -> Unit,
    onEvent: (NotificationEvent) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        KlinaraSegmentedPicker(
            options = MessageStatusFilter.entries,
            selected = state.status,
            onSelect = onStatus,
            title = { it.title },
            modifier = Modifier.fillMaxWidth(),
        )
        KlinaraSegmentedPicker(
            options = MessageChannelFilter.entries,
            selected = state.channel,
            onSelect = onChannel,
            title = { it.title },
            modifier = Modifier.fillMaxWidth(),
        )
        // Dokuz olay çip ızgarasında beş satır kaplıyor ve listeyi ekranın dışına itiyordu (iOS
        // notu); yatay kaydırma süzgecin listeden fazla yer tutmasını engelliyor.
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            NotificationEvent.selectable.forEach { event ->
                SelectableChip(
                    label = event.turkishName,
                    isSelected = state.event == event,
                    onClick = { onEvent(event) },
                )
            }
        }
    }
}

@Composable
private fun MessageRow(
    message: Message,
    clock: BranchClock,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier.fillMaxWidth().klinaraClickable(true, Role.Button, interactionSource, onClick),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                message.event.turkishName,
                style = KlinaraType.bodyEmphasis,
                color = colors.charcoal,
                modifier = Modifier.weight(1f),
            )
            KlinaraBadge(message.status.turkishName, tone = message.status.badgeTone)
        }
        Text(
            "${message.channel.turkishName} · ${message.to}",
            style = KlinaraType.bodyM,
            color = colors.charcoalMuted,
        )
        Text(clock.formatDateTime(message.createdAt), style = KlinaraType.bodyM, color = colors.charcoalMuted)
    }
}
