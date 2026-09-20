package com.klinara.android.features.notifications

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraFilterPill
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.designsystem.components.klinaraClickable
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import com.klinara.android.services.notifications.Message
import com.klinara.android.services.notifications.NotificationEvent

/**
 * Mesaj günlüğü (A8.1) — iOS `MessageLogView` paritesi: "gitti mi, gitmediyse neden?"
 *
 * `skipped` satırları **gizlenmez** (Ek M).
 *
 * **Kanal süzgeci yok:** klinik müşterisiyle yalnız WhatsApp üzerinden yazışıyor ve tek
 * seçenekli bir süzgeç, listeden fazla yer tutan bir yanıltma olurdu. Satır yine kanal adını
 * taşır — geçmişteki e-posta kayıtları okunur kalsın.
 *
 * Liste **gün gün** gruplanır ve başlıklar yapışkandır; tarih satır satır tekrar etmez, satırda
 * yalnız saat kalır. Sonraki sayfa artık bir düğmeyle değil, listenin sonuna gelindiğinde
 * istenir — bunun için gövde `KlinaraScreen`'in kaydırılan `Column`'u değil bir `LazyColumn`:
 * `verticalScroll` içindeki `Column` tüm çocuklarını anında besteler ve bir nöbetçi öğe sonsuz
 * döngü üretirdi.
 */
@OptIn(ExperimentalFoundationApi::class)
@Suppress("LongParameterList")
@Composable
fun MessageLogScreen(
    state: MessageLogUiState,
    clock: BranchClock,
    onStatus: (MessageStatusFilter) -> Unit,
    /** Özet şeridi: seçili sayaca tekrar dokunmak süzgeci kaldırır. */
    onToggleStatus: (MessageStatusFilter) -> Unit,
    onEvent: (NotificationEvent) -> Unit,
    onClearFilters: () -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onRetryLoadMore: () -> Unit,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    KlinaraScreen(title = "Mesaj günlüğü", modifier = modifier, onBack = onBack, scrollable = false) {
        Filters(state, onStatus, onEvent, onClearFilters)

        when (val messages = state.messages) {
            Loadable.Loading ->
                KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsLong)

            is Loadable.Failed ->
                ErrorBanner(message = messages.message, onRetry = if (messages.isRetryable) onRetry else null)

            is Loadable.Loaded ->
                if (messages.value.isEmpty()) {
                    EmptyStateView(
                        title = "Mesaj yok",
                        message =
                            if (state.filter.hasUserFilters) {
                                "Seçtiğiniz süzgeçlere uyan mesaj bulunamadı."
                            } else {
                                "Henüz hiçbir bildirim üretilmedi."
                            },
                        icon = Icons.Filled.MailOutline,
                        actionTitle = "Süzgeçleri temizle".takeIf { state.filter.hasUserFilters },
                        actionIcon = Icons.Filled.Clear,
                        onAction = onClearFilters.takeIf { state.filter.hasUserFilters },
                    )
                } else {
                    MessageList(
                        // Ağırlık ŞART: `LazyColumn` ağırlıksızken Column'un tamamı kadar
                        // yer ölçüyor ve süzgeç satırları kadar aşağı taşıyordu.
                        modifier = Modifier.weight(1f),
                        state = state,
                        clock = clock,
                        onToggleStatus = onToggleStatus,
                        onClearFilters = onClearFilters,
                        onOpen = onOpen,
                        onLoadMore = onLoadMore,
                        onRetryLoadMore = onRetryLoadMore,
                    )
                }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
@Suppress("LongParameterList")
private fun MessageList(
    modifier: Modifier,
    state: MessageLogUiState,
    clock: BranchClock,
    onToggleStatus: (MessageStatusFilter) -> Unit,
    onClearFilters: () -> Unit,
    onOpen: (String) -> Unit,
    onLoadMore: () -> Unit,
    onRetryLoadMore: () -> Unit,
) {
    val listState = rememberLazyListState()
    val groups = remember(state.rows, clock) { state.groups(clock) }

    // Sonsuz kaydırma: son öğe görününce sonraki sayfa istenir. `derivedStateOf` olmadan
    // her kaydırma karesi yeniden besteleme tetikliyordu.
    val isAtEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: return@derivedStateOf false
            last >= listState.layoutInfo.totalItemsCount - 2
        }
    }
    val canLoadMore = state.nextCursor != null && state.loadMoreError == null && !state.isLoadingMore
    LaunchedEffect(isAtEnd, canLoadMore) {
        if (isAtEnd && canLoadMore) onLoadMore()
    }

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        item(key = "summary") {
            SummaryStrip(state.summary, state.status, onToggleStatus, onClearFilters)
        }

        groups.forEach { group ->
            stickyHeader(key = "header-${group.day}") { DayHeader(group.title) }
            item(key = "group-${group.day}") {
                KlinaraCard {
                    group.messages.forEachIndexed { index, message ->
                        if (index > 0) KlinaraDivider()
                        MessageRow(message, clock, onClick = { onOpen(message.id) })
                    }
                }
            }
        }

        item(key = "footnote") {
            Text(
                footnote(state),
                style = KlinaraType.bodyM,
                color = KlinaraTheme.colors.charcoalMuted,
            )
        }

        item(key = "pagination") {
            when {
                state.loadMoreError != null ->
                    ErrorBanner(message = state.loadMoreError, onRetry = onRetryLoadMore)
                state.isLoadingMore ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = KlinaraMetrics.md),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(SPINNER_SIZE),
                            color = KlinaraTheme.colors.sage,
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
private fun DayHeader(title: String) {
    Text(
        // Kart başlıklarının aksine BÜYÜK HARFE çevrilmiyor: bu bir bölüm etiketi değil,
        // tarihin kendisi. "11 EYLÜL 2026" bağırıyor ve iOS'ta da öyle görünmüyor.
        title,
        style = KlinaraType.label,
        color = KlinaraTheme.colors.charcoalMuted,
        modifier =
            Modifier
                .fillMaxWidth()
                // Yapışkan başlık kaydırılan kartların üstünden geçiyor; zemin olmadan
                // iki metin üst üste okunuyordu.
                .background(KlinaraTheme.colors.surface)
                .padding(vertical = KlinaraMetrics.xs),
    )
}

/**
 * Üç sayaç. **Kapsamı yüklenmiş sayfalardır** ve dipnot bunu söyler: sunucuda sayaç ucu yok,
 * uydurulmuş bir toplam göstermektense neyin sayıldığını söylemek.
 */
@Composable
private fun SummaryStrip(
    summary: MessageLogSummary,
    status: MessageStatusFilter,
    onStatus: (MessageStatusFilter) -> Unit,
    onClearFilters: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
            SummaryTile(
                label = "Toplam",
                value = summary.total,
                isDanger = false,
                isSelected = status == MessageStatusFilter.All,
                onClick = onClearFilters,
            )
            SummaryTile(
                label = "Başarısız",
                value = summary.failed,
                isDanger = true,
                isSelected = status == MessageStatusFilter.Failed,
                onClick = { onStatus(MessageStatusFilter.Failed) },
            )
            SummaryTile(
                label = "Atlandı",
                value = summary.skipped,
                isDanger = false,
                isSelected = status == MessageStatusFilter.Skipped,
                onClick = { onStatus(MessageStatusFilter.Skipped) },
            )
        }
        Text(
            "Yüklenen ${summary.total} kayıt içinde.",
            style = KlinaraType.bodyM,
            color = KlinaraTheme.colors.charcoalMuted,
        )
    }
}

@Composable
private fun RowScope.SummaryTile(
    label: String,
    value: Int,
    isDanger: Boolean,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val shape = RoundedCornerShape(KlinaraMetrics.cardRadius)
    val interactionSource = remember { MutableInteractionSource() }
    Column(
        modifier =
            Modifier
                .weight(1f)
                .background(if (isSelected) colors.sageSoft else colors.surfaceRaised, shape)
                .border(KlinaraMetrics.borderWidth, if (isSelected) colors.sage else colors.border, shape)
                .klinaraClickable(true, Role.Button, interactionSource, onClick)
                .padding(KlinaraMetrics.md)
                .clearAndSetSemantics {
                    contentDescription = "$label: $value"
                    selected = isSelected
                },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            value.toString(),
            style = KlinaraType.titleM,
            color = if (isDanger && value > 0) colors.danger else colors.charcoal,
        )
        Text(label, style = KlinaraType.bodyM, color = colors.charcoalMuted, maxLines = 1)
    }
}

/**
 * İki segment seçici üst üste yığılınca listeyi ekranın dışına itiyordu; durum da olay da artık
 * aynı dili konuşan yatay çip satırları.
 */
@Composable
private fun Filters(
    state: MessageLogUiState,
    onStatus: (MessageStatusFilter) -> Unit,
    onEvent: (NotificationEvent) -> Unit,
    onClearFilters: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            MessageStatusFilter.entries.forEach { option ->
                KlinaraFilterPill(
                    label = option.title,
                    isSelected = option == state.status,
                    onClick = { onStatus(option) },
                )
            }
        }
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm),
        ) {
            NotificationEvent.selectable.forEach { event ->
                KlinaraFilterPill(
                    label = event.turkishName,
                    isSelected = state.event == event,
                    onClick = { onEvent(event) },
                )
            }
        }
        if (state.filter.hasUserFilters) {
            val interactionSource = remember { MutableInteractionSource() }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs),
                modifier = Modifier.klinaraClickable(true, Role.Button, interactionSource, onClearFilters),
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = null,
                    tint = KlinaraTheme.colors.sageDeep,
                    modifier = Modifier.size(CLEAR_ICON_SIZE),
                )
                Text("Süzgeçleri temizle", style = KlinaraType.bodyEmphasis, color = KlinaraTheme.colors.sageDeep)
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
    Row(
        modifier = Modifier.fillMaxWidth().klinaraClickable(true, Role.Button, interactionSource, onClick),
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        Icon(
            message.status.icon,
            contentDescription = null,
            tint = if (message.status.badgeTone == KlinaraBadgeTone.Warning) colors.danger else colors.charcoalMuted,
            modifier = Modifier.size(STATUS_ICON_SIZE),
        )
        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    message.event.turkishName,
                    style = KlinaraType.bodyEmphasis,
                    color = colors.charcoal,
                    modifier = Modifier.weight(1f),
                )
                KlinaraBadge(message.status.turkishName, tone = message.status.badgeTone)
            }
            // Gün başlıkta; satırda yalnız saat. Kanal adı duruyor çünkü geçmişte gerçekten
            // e-posta gönderilmiş satırlar var.
            Text(
                "${clock.formatTime(message.createdAt)} · ${message.channel.turkishName} · ${message.to}",
                style = KlinaraType.bodyM,
                color = colors.charcoalMuted,
            )
        }
    }
}

private val STATUS_ICON_SIZE = 20.dp
private val CLEAR_ICON_SIZE = 16.dp
private val SPINNER_SIZE = 24.dp
