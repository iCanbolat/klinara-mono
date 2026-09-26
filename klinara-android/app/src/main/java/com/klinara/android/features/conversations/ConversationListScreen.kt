package com.klinara.android.features.conversations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.klinara.android.designsystem.KlinaraMetrics
import com.klinara.android.designsystem.KlinaraTheme
import com.klinara.android.designsystem.KlinaraType
import com.klinara.android.designsystem.components.EmptyStateView
import com.klinara.android.designsystem.components.ErrorBanner
import com.klinara.android.designsystem.components.KlinaraBadge
import com.klinara.android.designsystem.components.KlinaraBadgeTone
import com.klinara.android.designsystem.components.KlinaraCard
import com.klinara.android.designsystem.components.KlinaraDivider
import com.klinara.android.designsystem.components.KlinaraIcons
import com.klinara.android.designsystem.components.KlinaraScreen
import com.klinara.android.designsystem.components.KlinaraSegmentedPicker
import com.klinara.android.designsystem.components.KlinaraSkeleton
import com.klinara.android.designsystem.components.KlinaraSkeletonStyle
import com.klinara.android.features.auth.AppSession
import com.klinara.android.services.ServiceContainer
import com.klinara.android.services.conversations.Conversation
import com.klinara.android.services.conversations.ConversationFilter
import com.klinara.android.services.formatting.BranchClock
import com.klinara.android.services.networking.Loadable
import java.util.Locale

/**
 * Sohbetler — iOS `ConversationListView` paritesi.
 *
 * Liste ekrana her dönüşte yenilenir: akışta okunan ya da kapatılan sohbet eski hâliyle kalmasın.
 */
@Composable
fun ConversationListScreen(
    session: AppSession,
    container: ServiceContainer,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: ConversationListViewModel =
        viewModel(key = "conversations", factory = ConversationListViewModel.factory(container))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val clock = remember(session.activeBranch?.timezone) { BranchClock(session.activeBranch?.timezone) }

    LaunchedEffect(Unit) { viewModel.load() }

    KlinaraScreen(title = "Sohbetler", modifier = modifier, onBack = onBack, onRefresh = viewModel::load) {
        KlinaraSegmentedPicker(
            options = ConversationFilter.entries,
            selected = state.filter,
            onSelect = viewModel::setFilter,
            title = { it.turkishName },
            modifier = Modifier.fillMaxWidth(),
        )

        when (val rows = state.conversations) {
            Loadable.Loading -> KlinaraSkeleton(style = KlinaraSkeletonStyle.cardsLong)
            is Loadable.Failed ->
                ErrorBanner(message = rows.message, onRetry = if (rows.isRetryable) viewModel::load else null)
            is Loadable.Loaded ->
                if (rows.value.isEmpty()) {
                    val open = state.filter == ConversationFilter.Open
                    EmptyStateView(
                        title = if (open) "Henüz sohbet yok" else "Bu süzgece uyan sohbet yok",
                        message =
                            if (open) {
                                "Müşteriler WhatsApp'tan yazdığında ya da bir hatırlatmayı yanıtladığında " +
                                    "sohbetler burada görünür."
                            } else {
                                "Başka bir süzgeç seçin."
                            },
                        iconRes = KlinaraIcons.conversations,
                    )
                } else {
                    KlinaraCard {
                        rows.value.forEachIndexed { index, conversation ->
                            if (index > 0) KlinaraDivider()
                            ConversationRow(conversation, clock, onClick = { onOpen(conversation.id) })
                        }
                    }
                    LoadMoreFooter(state, viewModel)
                }
        }
    }
}

@Composable
private fun LoadMoreFooter(
    state: ConversationListUiState,
    viewModel: ConversationListViewModel,
) {
    val error = state.loadMoreError
    when {
        error != null -> ErrorBanner(message = error, onRetry = viewModel::retryLoadMore)
        state.isLoadingMore ->
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        state.cursor != null -> LaunchedEffect(state.cursor) { viewModel.loadMore() }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConversationRow(
    conversation: Conversation,
    clock: BranchClock,
    onClick: () -> Unit,
) {
    val colors = KlinaraTheme.colors
    val preview =
        conversation.lastMessagePreview.orEmpty().let {
            if (conversation.lastMessageDirection == "out") "Siz: $it" else it
        }
    val time =
        if (clock.isToday(conversation.lastMessageAt)) {
            clock.formatTime(conversation.lastMessageAt)
        } else {
            clock.relativeDayLabel(conversation.lastMessageAt)
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .padding(KlinaraMetrics.md)
                .clearAndSetSemantics {
                    contentDescription =
                        listOfNotNull(
                            conversation.title,
                            "okunmadı".takeIf { conversation.unread },
                            preview,
                            time,
                        ).joinToString(", ")
                },
        horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.md),
    ) {
        Box(
            modifier = Modifier.size(AVATAR_SIZE).background(colors.sageSoft, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(initials(conversation), style = KlinaraType.bodyEmphasis, color = colors.sageDeep)
        }
        Column(verticalArrangement = Arrangement.spacedBy(KlinaraMetrics.xs)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    conversation.title,
                    style = if (conversation.unread) KlinaraType.bodyEmphasis else KlinaraType.bodyL,
                    color = colors.charcoal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(time, style = KlinaraType.bodyM, color = colors.charcoalMuted)
            }
            Text(
                preview,
                style = KlinaraType.bodyM.copy(fontWeight = if (conversation.unread) FontWeight.Medium else null),
                color = if (conversation.unread) colors.charcoal else colors.charcoalMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(KlinaraMetrics.sm)) {
                if (conversation.unread) KlinaraBadge("Okunmadı", tone = KlinaraBadgeTone.Positive)
                if (conversation.customer == null) KlinaraBadge("Kayıtlı değil", tone = KlinaraBadgeTone.Muted)
                if (!conversation.isClosed && !conversation.windowOpen) {
                    KlinaraBadge("Pencere kapalı", tone = KlinaraBadgeTone.Warning)
                }
            }
        }
    }
}

private fun initials(conversation: Conversation): String {
    val name = conversation.customer?.fullName ?: return "#"
    return name
        .split(" ")
        .filter { it.isNotBlank() }
        .take(2)
        .joinToString("") { it.take(1) }
        .uppercase(Locale.forLanguageTag("tr"))
}

private val AVATAR_SIZE = 40.dp
